package helm

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func createFakeKubeconfig() []byte {
	config := clientcmdapi.NewConfig()
	config.Clusters["local"] = &clientcmdapi.Cluster{Server: "http://localhost:8080"}
	config.Contexts["local"] = &clientcmdapi.Context{Cluster: "local"}
	config.CurrentContext = "local"
	data, _ := clientcmd.Write(*config)
	return data
}

func TestNewHelmClient(t *testing.T) {
	kubeconfig := createFakeKubeconfig()
	client, err := NewHelmClient(kubeconfig, "local", slog.Default())
	assert.NoError(t, err)
	assert.NotNil(t, client)

	h := client.(*helmClientImpl)
	assert.NotNil(t, h.restClientGetter)
	assert.NotEmpty(t, h.repoCachePath)

	// Check temp dir exists
	_, err = os.Stat(h.repoCachePath)
	assert.NoError(t, err)

	// Cleanup
	os.RemoveAll(h.repoCachePath)
}

func TestHelmClient_NewActionConfig(t *testing.T) {
	kubeconfig := createFakeKubeconfig()
	client, err := NewHelmClient(kubeconfig, "local", nil)
	assert.NoError(t, err)

	h := client.(*helmClientImpl)
	cfg, err := h.newActionConfig("default")
	assert.NoError(t, err)
	assert.NotNil(t, cfg)

	// Cleanup
	os.RemoveAll(h.repoCachePath)
}

func TestKubeConfigGetter(t *testing.T) {
	kubeconfig := createFakeKubeconfig()
	rawConfig, _ := clientcmd.Load(kubeconfig)
	clientConfig := clientcmd.NewDefaultClientConfig(*rawConfig, &clientcmd.ConfigOverrides{})
	getter := &kubeConfigGetter{clientConfig: clientConfig}

	cfg, err := getter.ToRESTConfig()
	assert.NoError(t, err)
	assert.Equal(t, "http://localhost:8080", cfg.Host)

	dc, err := getter.ToDiscoveryClient()
	assert.NoError(t, err)
	assert.NotNil(t, dc)

	mapper, err := getter.ToRESTMapper()
	assert.NoError(t, err)
	assert.NotNil(t, mapper)

	loader := getter.ToRawKubeConfigLoader()
	assert.NotNil(t, loader)
}

func TestHelmClient_AddOrUpdateRepo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/index.yaml" {
			w.Write([]byte(`apiVersion: v1
entries:
  test-chart:
    - version: 1.0.0
      name: test-chart
      urls: ["charts/test-chart-1.0.0.tgz"]
`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	kubeconfig := createFakeKubeconfig()
	client, err := NewHelmClient(kubeconfig, "local", nil)
	assert.NoError(t, err)

	h := client.(*helmClientImpl)
	defer os.RemoveAll(h.repoCachePath)

	err = h.AddOrUpdateRepo(context.Background(), "test-repo", server.URL)
	assert.NoError(t, err)

	assert.NotNil(t, h.repoFile.Get("test-repo"))
}

func TestIsOCIRef(t *testing.T) {
	assert.True(t, IsOCIRef("oci://registry.example.com/chart"))
	assert.False(t, IsOCIRef("https://charts.example.com"))
}

func TestParseChartRef(t *testing.T) {
	repo, name, err := parseChartRef("http://repo|mychart")
	assert.NoError(t, err)
	assert.Equal(t, "http://repo", repo)
	assert.Equal(t, "mychart", name)

	_, _, err = parseChartRef("invalid-ref")
	assert.Error(t, err)
}

func TestParseManifestToResourceDiff(t *testing.T) {
	manifest := `
apiVersion: v1
kind: Service
metadata:
  name: test-svc
  namespace: default
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-deploy
`
	diff, count := parseManifestToResourceDiff(manifest)
	assert.Equal(t, 2, count)
	assert.Len(t, diff, 2)
	assert.Equal(t, "Service", diff[0].Kind)
	assert.Equal(t, "test-svc", diff[0].Name)
	assert.Equal(t, "Deployment", diff[1].Kind)
	assert.Equal(t, "test-deploy", diff[1].Name)
}

func TestComputeResourceDiff(t *testing.T) {
	existing := `
apiVersion: v1
kind: ConfigMap
metadata:
  name: old-cm
  namespace: default
`
	newManifest := `
apiVersion: v1
kind: ConfigMap
metadata:
  name: old-cm
  namespace: default
---
apiVersion: v1
kind: Secret
metadata:
  name: new-secret
  namespace: default
`
	diff := computeResourceDiff(existing, newManifest)
	// old-cm should be "update", new-secret should be "create"
	// and also check "delete" if we remove something.

	foundUpdate := false
	foundCreate := false
	for _, c := range diff {
		if c.Action == "update" && c.Name == "old-cm" {
			foundUpdate = true
		}
		if c.Action == "create" && c.Name == "new-secret" {
			foundCreate = true
		}
	}
	assert.True(t, foundUpdate)
	assert.True(t, foundCreate)
}

func TestResourceKey(t *testing.T) {
	assert.Equal(t, "default/Pod/myapp", resourceKey("", "Pod", "myapp"))
	assert.Equal(t, "kube-system/Pod/myapp", resourceKey("kube-system", "Pod", "myapp"))

	ns, kind, name := parseResourceKey("ns/kind/name")
	assert.Equal(t, "ns", ns)
	assert.Equal(t, "kind", kind)
	assert.Equal(t, "name", name)
}

func TestReleaseConversions(t *testing.T) {
	rel := &release.Release{
		Name:      "myrel",
		Namespace: "myns",
		Version:   1,
		Info: &release.Info{
			Status:       release.StatusDeployed,
			Description:  "Install complete",
			LastDeployed: helmtime.Now(),
		},
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Name:       "mychart",
				Version:    "1.2.3",
				AppVersion: "2.0.0",
			},
		},
		Manifest: "manifest-content",
	}

	status := releaseToStatus(rel)
	assert.Equal(t, "myrel", status.ReleaseName)
	assert.Equal(t, "deployed", status.Status)
	assert.Equal(t, "1.2.3", status.ChartVersion)
	assert.Equal(t, "2.0.0", status.AppVersion)
	assert.Equal(t, "manifest-content", status.Manifest)

	info := releaseToHelmReleaseInfo(rel)
	assert.Equal(t, "myrel", info.Name)
	assert.Equal(t, "deployed", info.Status)
	assert.Equal(t, "mychart", info.ChartName)
	assert.Equal(t, "1.2.3", info.ChartVersion)

	rev := releaseToRevision(rel)
	assert.Equal(t, 1, rev.Revision)
	installRes := releaseToInstallResult(rel)
	assert.Equal(t, "myrel", installRes.ReleaseName)
	assert.Equal(t, 1, installRes.Revision)
}
