package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// FileEntry represents a single file/directory entry returned by ListContainerFiles.
type FileEntry struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // "file", "dir", "link", "other"
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

// listFilesRequest is the JSON body for POST /ls.
type listFilesRequest struct {
	Path      string `json:"path"`
	Container string `json:"container"`
}

// uploadResponse is the JSON body returned by POST /upload.
type uploadResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

const (
	fileTransferTimeout = 30 * time.Second
	maxUploadSize       = 50 << 20 // 50 MB
)

// sanitizeContainerPath validates and cleans a container file path to prevent path traversal.
func sanitizeContainerPath(p string) (string, error) {
	if p == "" {
		return "/", nil
	}
	cleaned := path.Clean(p)
	if !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}
	// Reject any attempt to traverse outside root after cleaning
	if strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("path traversal not allowed")
	}
	return cleaned, nil
}

// resolveContainerName returns the container name to use: the provided one if non-empty,
// the single container if the pod has exactly one, or an error if ambiguous.
func resolveContainerName(ctx context.Context, client *k8s.Client, namespace, podName, container string) (string, error) {
	if container != "" {
		return container, nil
	}
	pod, err := client.Clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("pod not found: %w", err)
	}
	if len(pod.Spec.Containers) == 1 {
		return pod.Spec.Containers[0].Name, nil
	}
	names := make([]string, 0, len(pod.Spec.Containers))
	for _, c := range pod.Spec.Containers {
		names = append(names, c.Name)
	}
	return "", fmt.Errorf("container is required when pod has multiple containers; valid: %s", strings.Join(names, ", "))
}

// execInContainer runs a command in a pod container using the K8s exec API.
// Returns stdout string, stderr string, and any error.
func execInContainer(ctx context.Context, client *k8s.Client, namespace, podName, container string, command []string, stdinData []byte) (string, string, error) {
	hasStdin := len(stdinData) > 0

	req := client.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   command,
			Stdin:     hasStdin,
			Stdout:    true,
			Stderr:    true,
			TTY:       false,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(client.Config, "POST", req.URL())
	if err != nil {
		return "", "", fmt.Errorf("failed to create executor: %w", err)
	}

	var stdout, stderr bytes.Buffer
	opts := remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
		Tty:    false,
	}
	if hasStdin {
		opts.Stdin = bytes.NewReader(stdinData)
	}

	if err := executor.StreamWithContext(ctx, opts); err != nil {
		return stdout.String(), stderr.String(), err
	}
	return stdout.String(), stderr.String(), nil
}

// ListContainerFiles handles POST /clusters/{clusterId}/resources/{namespace}/{pod}/ls
// Executes `ls -la {path}` in the container via K8s exec API and returns parsed entries.
func (h *Handler) ListContainerFiles(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	podName := vars["pod"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(podName) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod name")
		return
	}

	var req listFilesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	dirPath, err := sanitizeContainerPath(req.Path)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), fileTransferTimeout)
	defer cancel()

	container, err := resolveContainerName(ctx, client, namespace, podName, req.Container)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Execute ls -la in the container; use --time-style=long-iso for parseable timestamps.
	// Fall back to plain ls -la if --time-style is not supported (busybox).
	command := []string{"ls", "-la", "--time-style=long-iso", dirPath}
	stdout, _, err := execInContainer(ctx, client, namespace, podName, container, command, nil)
	if err != nil {
		// Retry without --time-style for busybox environments
		command = []string{"ls", "-la", dirPath}
		var stderr string
		stdout, stderr, err = execInContainer(ctx, client, namespace, podName, container, command, nil)
		if err != nil {
			respondError(w, http.StatusInternalServerError, fmt.Sprintf("exec failed: %s — %s", err.Error(), stderr))
			return
		}
	}

	entries := parseLsOutput(stdout)
	respondJSON(w, http.StatusOK, entries)
}

// DownloadContainerFile handles GET /clusters/{clusterId}/resources/{namespace}/{pod}/download
// Streams file content from the container via `cat {path}`.
func (h *Handler) DownloadContainerFile(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	podName := vars["pod"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(podName) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod name")
		return
	}

	filePath := r.URL.Query().Get("path")
	container := r.URL.Query().Get("container")

	cleanPath, err := sanitizeContainerPath(filePath)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), fileTransferTimeout)
	defer cancel()

	container, err = resolveContainerName(ctx, client, namespace, podName, container)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	command := []string{"cat", cleanPath}
	stdout, stderr, err := execInContainer(ctx, client, namespace, podName, container, command, nil)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("exec failed: %s — %s", err.Error(), stderr))
		return
	}

	fileName := path.Base(cleanPath)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(stdout))
}

// UploadContainerFile handles POST /clusters/{clusterId}/resources/{namespace}/{pod}/upload
// Accepts multipart form with file + path + container, writes to container via `tee`.
func (h *Handler) UploadContainerFile(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	podName := vars["pod"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(podName) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod name")
		return
	}

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		respondError(w, http.StatusBadRequest, "Failed to parse multipart form: "+err.Error())
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		respondError(w, http.StatusBadRequest, "Missing 'file' in form data: "+err.Error())
		return
	}
	defer func() { _ = file.Close() }()

	destPath := r.FormValue("path")
	container := r.FormValue("container")

	cleanPath, err := sanitizeContainerPath(destPath)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), fileTransferTimeout)
	defer cancel()

	container, err = resolveContainerName(ctx, client, namespace, podName, container)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Read file content
	fileContent, err := io.ReadAll(file)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to read uploaded file: "+err.Error())
		return
	}

	command := []string{"tee", cleanPath}
	_, stderr, err := execInContainer(ctx, client, namespace, podName, container, command, fileContent)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("upload failed: %s — %s", err.Error(), stderr))
		return
	}

	respondJSON(w, http.StatusOK, uploadResponse{
		Success: true,
		Message: fmt.Sprintf("File uploaded to %s", cleanPath),
	})
}

// parseLsOutput parses the output of `ls -la` into FileEntry slices.
// Handles both GNU ls (--time-style=long-iso) and busybox ls output formats.
func parseLsOutput(output string) []FileEntry {
	var entries []FileEntry
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}

		entry := parseLsLine(line)
		if entry != nil && entry.Name != "." && entry.Name != ".." {
			entries = append(entries, *entry)
		}
	}
	return entries
}

// parseLsLine parses a single line of `ls -la` output.
// Expected format (GNU --time-style=long-iso):
//
//	-rw-r--r-- 1 root root 1234 2024-01-15 10:30 filename
//
// Fallback format (busybox/standard):
//
//	-rw-r--r--    1 root     root          1234 Jan 15 10:30 filename
func parseLsLine(line string) *FileEntry {
	if len(line) < 10 {
		return nil
	}

	// Determine type from first character
	var fileType string
	switch line[0] {
	case 'd':
		fileType = "dir"
	case 'l':
		fileType = "link"
	case '-':
		fileType = "file"
	default:
		fileType = "other"
	}

	// Split into fields; filenames with spaces are handled by taking everything after the timestamp
	fields := strings.Fields(line)
	if len(fields) < 8 {
		return nil
	}

	// Try to find the size field (always a number) — it's typically field index 4
	var sizeIdx int
	var size int64
	for i := 3; i < len(fields) && i < 6; i++ {
		n, err := parseInt64(fields[i])
		if err == nil {
			size = n
			sizeIdx = i
			break
		}
	}
	if sizeIdx == 0 {
		// Could not find a size field; use best-effort defaults
		sizeIdx = 4
	}

	// After sizeIdx, the next fields are the date/time, then the filename.
	// GNU long-iso: 2024-01-15 10:30 filename  (2 date fields)
	// Standard:     Jan 15 10:30 filename      (3 date fields)
	// Standard:     Jan 15  2024 filename      (3 date fields)

	var nameStart int
	var modified string

	remaining := len(fields) - sizeIdx - 1
	if remaining >= 3 {
		// Check if it looks like GNU long-iso (YYYY-MM-DD HH:MM)
		dateField := fields[sizeIdx+1]
		if len(dateField) == 10 && dateField[4] == '-' && dateField[7] == '-' {
			// GNU long-iso format
			modified = dateField + " " + fields[sizeIdx+2]
			nameStart = sizeIdx + 3
		} else if remaining >= 4 {
			// Standard ls: Mon DD HH:MM or Mon DD YYYY
			modified = strings.Join(fields[sizeIdx+1:sizeIdx+4], " ")
			nameStart = sizeIdx + 4
		} else {
			modified = strings.Join(fields[sizeIdx+1:sizeIdx+3], " ")
			nameStart = sizeIdx + 3
		}
	} else if remaining >= 2 {
		modified = strings.Join(fields[sizeIdx+1:sizeIdx+2], " ")
		nameStart = sizeIdx + 2
	} else {
		return nil
	}

	if nameStart >= len(fields) {
		return nil
	}

	// Reconstruct name (may contain spaces); for symlinks, strip " -> target"
	name := strings.Join(fields[nameStart:], " ")
	if fileType == "link" {
		if idx := strings.Index(name, " -> "); idx >= 0 {
			name = name[:idx]
		}
	}

	return &FileEntry{
		Name:     name,
		Type:     fileType,
		Size:     size,
		Modified: modified,
	}
}

// parseInt64 is a helper that parses a string as int64.
func parseInt64(s string) (int64, error) {
	var n int64
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("not a number")
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
}
