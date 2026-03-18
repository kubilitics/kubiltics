package cli

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestParseMultiClusterOptions(t *testing.T) {
	t.Run("regular args", func(t *testing.T) {
		opts, err := parseMultiClusterOptions([]string{"pods", "-A"})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if opts.AllContexts {
			t.Fatalf("expected AllContexts false")
		}
		if len(opts.Args) != 2 {
			t.Fatalf("expected args passthrough, got %v", opts.Args)
		}
	})

	t.Run("all contexts with group", func(t *testing.T) {
		opts, err := parseMultiClusterOptions([]string{"pods", "--all-contexts", "--context-group=prod"})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !opts.AllContexts {
			t.Fatalf("expected AllContexts true")
		}
		if opts.Group != "prod" {
			t.Fatalf("expected group prod, got %q", opts.Group)
		}
		if len(opts.Args) != 1 || opts.Args[0] != "pods" {
			t.Fatalf("expected cleaned args, got %v", opts.Args)
		}
	})

	t.Run("missing group value", func(t *testing.T) {
		_, err := parseMultiClusterOptions([]string{"pods", "--context-group"})
		if err == nil {
			t.Fatalf("expected error")
		}
	})
}

func TestDefaultMaxConcurrency(t *testing.T) {
	if DefaultMaxConcurrency <= 0 {
		t.Fatalf("DefaultMaxConcurrency must be positive, got %d", DefaultMaxConcurrency)
	}
	if DefaultMaxConcurrency != 10 {
		t.Fatalf("expected DefaultMaxConcurrency=10, got %d", DefaultMaxConcurrency)
	}
}

// TestSemaphoreLimitsConcurrency verifies that the channel-based semaphore
// pattern used in runGetWithMultiCluster never allows more than
// DefaultMaxConcurrency goroutines to run concurrently.
func TestSemaphoreLimitsConcurrency(t *testing.T) {
	const totalWork = 50 // simulate 50 contexts

	sem := make(chan struct{}, DefaultMaxConcurrency)
	var wg sync.WaitGroup

	var peak int64 // track peak concurrency
	var active int64

	for i := 0; i < totalWork; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			cur := atomic.AddInt64(&active, 1)
			// Update peak (simple CAS loop)
			for {
				old := atomic.LoadInt64(&peak)
				if cur <= old {
					break
				}
				if atomic.CompareAndSwapInt64(&peak, old, cur) {
					break
				}
			}
			// Simulate some work so goroutines overlap
			for j := 0; j < 1000; j++ {
				_ = j
			}
			atomic.AddInt64(&active, -1)
		}()
	}
	wg.Wait()

	observed := atomic.LoadInt64(&peak)
	if observed > int64(DefaultMaxConcurrency) {
		t.Fatalf("peak concurrency %d exceeded limit %d", observed, DefaultMaxConcurrency)
	}
	if observed == 0 {
		t.Fatalf("expected at least 1 goroutine to run, got peak 0")
	}
	t.Logf("peak concurrency: %d (limit %d, workers %d)", observed, DefaultMaxConcurrency, totalWork)
}

func TestHasNamespaceFlag(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want bool
	}{
		{name: "short form", args: []string{"pods", "-n", "default"}, want: true},
		{name: "long form", args: []string{"pods", "--namespace", "default"}, want: true},
		{name: "long equals", args: []string{"pods", "--namespace=default"}, want: true},
		{name: "none", args: []string{"pods", "-A"}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := hasNamespaceFlag(tc.args)
			if got != tc.want {
				t.Fatalf("hasNamespaceFlag(%v)=%v, want %v", tc.args, got, tc.want)
			}
		})
	}
}
