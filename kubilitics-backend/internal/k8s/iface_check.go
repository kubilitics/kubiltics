package k8s

import "github.com/kubilitics/kubilitics-backend/internal/pkg/k8siface"

// Compile-time assertions: if the method signatures on Client or
// InformerManager ever drift from the k8siface contracts, this file
// fails to compile and surfaces the breakage immediately.
var (
	_ k8siface.ResourceLister    = (*Client)(nil)
	_ k8siface.ResourceReader    = (*Client)(nil)
	_ k8siface.ResourceWriter    = (*Client)(nil)
	_ k8siface.ResourceReadWriter = (*Client)(nil)
	_ k8siface.CacheLister       = (*InformerManager)(nil)
)
