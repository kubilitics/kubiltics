package rest

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/addon/financial"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// addonPlanBody is the JSON body for POST .../addons/plan
type addonPlanBody struct {
	AddonID   string `json:"addon_id"`
	Namespace string `json:"namespace"`
}

// addonPreflightBody is the JSON body for POST .../addons/preflight
type addonPreflightBody struct {
	Plan *models.InstallPlan `json:"plan"`
}

// addonCostBody is the JSON body for POST .../addons/estimate-cost
type addonCostBody struct {
	Plan *models.InstallPlan `json:"plan"`
}

// addonInstallBody is the JSON body for POST .../addons/execute (and dry-run),
// and the first WebSocket message on the stream endpoint.
type addonInstallBody struct {
	AddonID         string                 `json:"addon_id"`
	ReleaseName     string                 `json:"release_name"`
	Namespace       string                 `json:"namespace"`
	Values          map[string]interface{} `json:"values"`
	CreateNamespace bool                   `json:"create_namespace"`
	PlanID          string                 `json:"plan_id"`
	// IdempotencyKey is used by the WebSocket stream endpoint (where HTTP headers aren't
	// available). HTTP clients should use the X-Idempotency-Key header instead.
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// addonUpgradeBody is the JSON body for POST .../installed/{installId}/upgrade
type addonUpgradeBody struct {
	Version     string                 `json:"version"`
	Values      map[string]interface{} `json:"values"`
	ReuseValues bool                   `json:"reuse_values"`
}

// addonRollbackBody is the JSON body for POST .../installed/{installId}/rollback
type addonRollbackBody struct {
	Revision int `json:"revision"`
}

func (h *Handler) ListCatalog(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 24
	}
	if limit > 100 {
		limit = 100
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}
	if page, _ := strconv.Atoi(r.URL.Query().Get("page")); page > 1 {
		offset = (page - 1) * limit
	}
	entries, total, err := h.addonService.ListCatalog(r.Context(), search, limit, offset)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{"items": entries, "total": total})
}

func (h *Handler) GetCatalogEntry(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	rawAddonID := vars["addonId"]
	if rawAddonID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "addonId required")
		return
	}
	addonID, err := url.PathUnescape(rawAddonID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid addonId encoding")
		return
	}
	detail, err := h.addonService.GetAddOn(r.Context(), addonID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *Handler) PlanInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body addonPlanBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.AddonID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "addon_id required")
		return
	}
	if body.Namespace == "" {
		body.Namespace = "default"
	}
	plan, err := h.addonService.PlanInstall(r.Context(), clusterID, body.AddonID, body.Namespace)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, plan)
}

func (h *Handler) RunPreflight(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body addonPreflightBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Plan == nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body: plan required")
		return
	}
	report, err := h.addonService.RunPreflight(r.Context(), clusterID, body.Plan)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, report)
}

func (h *Handler) EstimateCost(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body addonCostBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Plan == nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body: plan required")
		return
	}
	estimate, err := h.addonService.EstimateCost(r.Context(), clusterID, body.Plan)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, estimate)
}

func (h *Handler) DryRunInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body addonInstallBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.AddonID == "" || body.Namespace == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "addon_id and namespace required")
		return
	}
	if body.ReleaseName == "" {
		body.ReleaseName = body.AddonID
	}
	actor := ""
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.Username
	}
	req := service.InstallRequest{
		AddonID:         body.AddonID,
		ReleaseName:     body.ReleaseName,
		Namespace:       body.Namespace,
		Values:          body.Values,
		CreateNamespace: body.CreateNamespace,
		Actor:           actor,
	}
	result, err := h.addonService.DryRunInstall(r.Context(), clusterID, req)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, result)
}

func (h *Handler) ExecuteInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body addonInstallBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.AddonID == "" || body.Namespace == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "addon_id and namespace required")
		return
	}
	if body.ReleaseName == "" {
		body.ReleaseName = body.AddonID
	}
	actor := ""
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.Username
	}
	req := service.InstallRequest{
		AddonID:         body.AddonID,
		ReleaseName:     body.ReleaseName,
		Namespace:       body.Namespace,
		Values:          body.Values,
		CreateNamespace: body.CreateNamespace,
		Actor:           actor,
		// X-Idempotency-Key deduplications retried requests: same key returns existing install.
		IdempotencyKey: strings.TrimSpace(r.Header.Get("X-Idempotency-Key")),
	}
	install, err := h.addonService.ExecuteInstall(r.Context(), clusterID, req, nil)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"install_id": install.ID})
}

func (h *Handler) ListInstalled(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	list, err := h.addonService.ListClusterAddOns(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, list)
}

func (h *Handler) GetInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	install, err := h.addonService.GetInstall(r.Context(), installID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	if install.ClusterID != clusterID {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, "install not found")
		return
	}
	respondJSON(w, http.StatusOK, install)
}

func (h *Handler) UpgradeInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	var body addonUpgradeBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	actor := ""
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.Username
	}
	req := service.UpgradeRequest{Version: body.Version, Values: body.Values, ReuseValues: body.ReuseValues, Actor: actor}
	if err := h.addonService.ExecuteUpgrade(r.Context(), clusterID, installID, req, nil); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h *Handler) RollbackInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	var body addonRollbackBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.Revision <= 0 {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "revision required")
		return
	}
	if err := h.addonService.ExecuteRollback(r.Context(), clusterID, installID, body.Revision); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h *Handler) UninstallAddon(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	deleteCRDs := r.URL.Query().Get("purge") == "true" || r.URL.Query().Get("deleteCrds") == "true"
	if err := h.addonService.ExecuteUninstall(r.Context(), clusterID, installID, deleteCRDs); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetReleaseHistory(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	history, err := h.addonService.GetReleaseHistory(r.Context(), clusterID, installID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, history)
}

func (h *Handler) GetAuditEvents(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	filter := models.AddOnAuditFilter{ClusterID: clusterID, AddonInstallID: installID, Limit: 100}
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			filter.Limit = n
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			filter.Offset = n
		}
	}
	events, err := h.addonService.GetAuditEvents(r.Context(), filter)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, events)
}

func (h *Handler) SetUpgradePolicy(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	_, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]
	if installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "installId required")
		return
	}
	var policy models.AddOnUpgradePolicy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	policy.AddonInstallID = installID
	if err := h.addonService.SetUpgradePolicy(r.Context(), installID, policy); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"message": "ok"})
}

func (h *Handler) GetFinancialStack(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	stack, err := h.addonService.GetFinancialStack(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	if stack == nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"prometheus_installed":         false,
			"prometheus_endpoint":          "",
			"opencost_installed":           false,
			"opencost_endpoint":            "",
			"kube_state_metrics_installed": false,
		})
		return
	}
	respondJSON(w, http.StatusOK, stack)
}

func (h *Handler) BuildFinancialStackPlan(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	plan, err := h.addonService.BuildFinancialStackPlan(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	if plan == nil {
		respondJSON(w, http.StatusOK, &models.InstallPlan{ClusterID: clusterID, Steps: []models.InstallStep{}, GeneratedAt: time.Now().UTC()})
		return
	}
	respondJSON(w, http.StatusOK, plan)
}

func (h *Handler) GetRBACManifest(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	addonID := vars["addonId"]
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}
	yaml, err := h.addonService.GenerateRBACManifest(r.Context(), clusterID, addonID, namespace)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/yaml")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(yaml))
}

// ── Cluster Bootstrap Profile handlers (T8.04) ────────────────────────────────

// addonCreateProfileBody is the JSON body for POST /addons/profiles
type addonCreateProfileBody struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Addons      []models.ProfileAddon `json:"addons"`
}

// addonApplyProfileBody is the JSON body for POST /clusters/{clusterId}/addons/apply-profile
type addonApplyProfileBody struct {
	ProfileID string `json:"profile_id"`
}

func (h *Handler) ListProfiles(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	profiles, err := h.addonService.ListProfiles(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, profiles)
}

func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	profileID := vars["profileId"]
	if profileID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "profileId required")
		return
	}
	profile, err := h.addonService.GetProfile(r.Context(), profileID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, profile)
}

func (h *Handler) CreateProfile(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	var body addonCreateProfileBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.Name == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "name required")
		return
	}
	profile := &models.ClusterProfile{
		Name:        body.Name,
		Description: body.Description,
		Addons:      body.Addons,
		IsBuiltin:   false,
	}
	if err := h.addonService.CreateProfile(r.Context(), profile); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, profile)
}

// ApplyProfile streams NDJSON progress events while installing all profile addons.
// Each line is a JSON-encoded InstallProgressEvent.
func (h *Handler) ApplyProfile(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body addonApplyProfileBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.ProfileID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "profile_id required")
		return
	}
	actor := ""
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.Username
	}

	// Stream NDJSON progress events.
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	flusher, canFlush := w.(http.Flusher)

	progressCh := make(chan service.InstallProgressEvent, 32)
	errCh := make(chan error, 1)

	go func() {
		errCh <- h.addonService.ApplyProfile(r.Context(), clusterID, body.ProfileID, actor, progressCh)
		close(progressCh)
	}()

	enc := json.NewEncoder(w)
	for event := range progressCh {
		_ = enc.Encode(event)
		if canFlush {
			flusher.Flush()
		}
	}

	// Emit a terminal event if ApplyProfile returned an error.
	if err := <-errCh; err != nil {
		_ = enc.Encode(service.InstallProgressEvent{
			Step:      "profile.failed",
			Message:   err.Error(),
			Status:    "failed",
			Timestamp: time.Now(),
		})
		if canFlush {
			flusher.Flush()
		}
	}
}

// ── Multi-Cluster Rollout handlers (T8.06) ────────────────────────────────────

// addonCreateRolloutBody is the JSON body for POST /addons/rollouts
type addonCreateRolloutBody struct {
	AddonID       string   `json:"addon_id"`
	TargetVersion string   `json:"target_version"`
	Strategy      string   `json:"strategy"`       // "all-at-once" | "canary"; default "all-at-once"
	CanaryPercent int      `json:"canary_percent"` // 0-100; only used when strategy="canary"
	ClusterIDs    []string `json:"cluster_ids"`
}

func (h *Handler) CreateRollout(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	var body addonCreateRolloutBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.AddonID == "" || body.TargetVersion == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "addon_id and target_version required")
		return
	}
	if len(body.ClusterIDs) == 0 {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "at least one cluster_id required")
		return
	}
	actor := ""
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		actor = claims.Username
	}
	rollout, err := h.addonService.CreateRollout(r.Context(), body.AddonID, body.TargetVersion, body.Strategy, body.CanaryPercent, body.ClusterIDs, actor)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}
	respondJSON(w, http.StatusAccepted, rollout)
}

func (h *Handler) ListRollouts(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	addonID := r.URL.Query().Get("addon_id")
	rollouts, err := h.addonService.ListRollouts(r.Context(), addonID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, rollouts)
}

func (h *Handler) GetRollout(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	rolloutID := mux.Vars(r)["rolloutId"]
	if rolloutID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "rolloutId required")
		return
	}
	rollout, err := h.addonService.GetRollout(r.Context(), rolloutID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, rollout)
}

func (h *Handler) AbortRollout(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	rolloutID := mux.Vars(r)["rolloutId"]
	if rolloutID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "rolloutId required")
		return
	}
	if err := h.addonService.AbortRollout(r.Context(), rolloutID); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// ── Cost Attribution handler (T8.09) ─────────────────────────────────────────

// GetCostAttribution handles GET /clusters/{clusterId}/addons/installed/{installId}/cost-attribution.
// It fetches live cost data from OpenCost for the addon's Helm release and returns
// an AddonCostAttribution JSON. Returns 204 when OpenCost is not available.
func (h *Handler) GetCostAttribution(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	installID := vars["installId"]
	if clusterID == "" || installID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "clusterId and installId required")
		return
	}

	install, err := h.addonService.GetInstall(r.Context(), installID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, "install not found")
		return
	}

	// Build OpenCost endpoint from cluster's Prometheus service discovery.
	// The endpoint resolution uses the convention: http://opencost.opencost.svc.cluster.local:9003
	opencostEndpoint := r.URL.Query().Get("opencost_endpoint")
	if opencostEndpoint == "" {
		opencostEndpoint = "http://opencost.opencost.svc.cluster.local:9003"
	}
	window := r.URL.Query().Get("window")
	if window == "" {
		window = "30d"
	}

	client := financial.NewOpenCostClient(opencostEndpoint)
	attribution, err := client.GetReleaseAllocation(r.Context(), install.ReleaseName, install.Namespace, window)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	if attribution == nil {
		// OpenCost not available — return 204 so the UI can degrade gracefully.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	attribution.AddonInstallID = installID
	respondJSON(w, http.StatusOK, attribution)
}

func (h *Handler) GetAddonRecommendations(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]

	rec, err := h.addonService.GetRecommendations(r.Context(), clusterID, installID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	if rec == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	respondJSON(w, http.StatusOK, rec)
}

func (h *Handler) GetAddonAdvisorRecommendations(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	recs, err := h.addonService.GetAdvisorRecommendations(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, recs)
}

// RunAddonTests handles POST /clusters/{clusterId}/addons/installed/{installId}/test (T9.01).
// It triggers helm test for the release and returns a TestResult with per-hook pass/fail status.
func (h *Handler) RunAddonTests(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	installID := vars["installId"]

	result, err := h.addonService.RunAddonTests(r.Context(), clusterID, installID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, result)
}

// ─── Maintenance window handlers (T9.03) ─────────────────────────────────────

type maintenanceWindowBody struct {
	Name            string `json:"name"`
	DayOfWeek       int    `json:"day_of_week"` // -1 = every day
	StartHour       int    `json:"start_hour"`
	StartMinute     int    `json:"start_minute"`
	Timezone        string `json:"timezone"`
	DurationMinutes int    `json:"duration_minutes"`
	ApplyTo         string `json:"apply_to"` // "all" or JSON array
}

// ListMaintenanceWindows handles GET /clusters/{clusterId}/addons/maintenance-windows.
func (h *Handler) ListMaintenanceWindows(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	clusterID, err := h.resolveClusterID(r.Context(), mux.Vars(r)["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	windows, err := h.addonService.ListMaintenanceWindows(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	if windows == nil {
		windows = []models.AddonMaintenanceWindow{}
	}
	respondJSON(w, http.StatusOK, windows)
}

// CreateMaintenanceWindow handles POST /clusters/{clusterId}/addons/maintenance-windows.
func (h *Handler) CreateMaintenanceWindow(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	clusterID, err := h.resolveClusterID(r.Context(), mux.Vars(r)["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body maintenanceWindowBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.Name == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "name is required")
		return
	}
	if body.DurationMinutes <= 0 {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "duration_minutes must be > 0")
		return
	}
	applyTo := body.ApplyTo
	if applyTo == "" {
		applyTo = "all"
	}
	tz := body.Timezone
	if tz == "" {
		tz = "UTC"
	}
	win := &models.AddonMaintenanceWindow{
		ClusterID:       clusterID,
		Name:            body.Name,
		DayOfWeek:       body.DayOfWeek,
		StartHour:       body.StartHour,
		StartMinute:     body.StartMinute,
		Timezone:        tz,
		DurationMinutes: body.DurationMinutes,
		ApplyTo:         applyTo,
	}
	if err := h.addonService.CreateMaintenanceWindow(r.Context(), win); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, win)
}

// DeleteMaintenanceWindow handles DELETE /clusters/{clusterId}/addons/maintenance-windows/{windowId}.
func (h *Handler) DeleteMaintenanceWindow(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	windowID := mux.Vars(r)["windowId"]
	if windowID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "windowId required")
		return
	}
	if err := h.addonService.DeleteMaintenanceWindow(r.Context(), windowID); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Private catalog source handlers (T9.04) ─────────────────────────────────

// ListCatalogSources handles GET /addons/registries.
func (h *Handler) ListCatalogSources(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	sources, err := h.addonService.ListCatalogSources(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	if sources == nil {
		sources = []models.PrivateCatalogSource{}
	}
	respondJSON(w, http.StatusOK, sources)
}

// CreateCatalogSource handles POST /addons/registries.
func (h *Handler) CreateCatalogSource(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	var s models.PrivateCatalogSource
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if s.URL == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "url is required")
		return
	}
	if err := h.addonService.CreateCatalogSource(r.Context(), &s); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, s)
}

// DeleteCatalogSource handles DELETE /addons/registries/{sourceId}.
func (h *Handler) DeleteCatalogSource(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	sourceID := mux.Vars(r)["sourceId"]
	if sourceID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "sourceId required")
		return
	}
	if err := h.addonService.DeleteCatalogSource(r.Context(), sourceID); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
