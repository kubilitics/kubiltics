package router

import (
	"context"
	"errors"
)

// PickFunc decides which Engine handles a request. v1 default just picks
// the first engine. 3b+ may wire a smarter dispatcher (e.g., LLM for
// simple Q&A, multi-agent for "investigate X", kagent for "run agent Y").
type PickFunc func(req Request, available []Engine) (Engine, error)

// Default picker: picks the first registered engine. Adequate for v1
// (LLM only). Future plans will replace this with a real dispatcher.
func Default() PickFunc {
	return func(req Request, available []Engine) (Engine, error) {
		if len(available) == 0 {
			return nil, errors.New("router: no engines registered")
		}
		return available[0], nil
	}
}

// Router holds engines and dispatches turns. Caller registers engines once
// at construction; per-request the Pick function chooses one.
type Router struct {
	engines []Engine
	pick    PickFunc
}

// New constructs a Router. If pick is nil, Default() is used.
func New(engines []Engine, pick PickFunc) *Router {
	if pick == nil {
		pick = Default()
	}
	return &Router{engines: engines, pick: pick}
}

// Engines returns the list of registered engine names. Used by Capabilities.
func (r *Router) Engines() []string {
	out := make([]string, 0, len(r.engines))
	for _, e := range r.engines {
		out = append(out, e.Name())
	}
	return out
}

// Dispatch picks an engine for the request and returns its event stream.
// The chosen engine name is returned so the runtime can log it (internal
// observability — never surfaced to the wire per the Output Normalizer rule).
func (r *Router) Dispatch(ctx context.Context, req Request) (engineName string, events <-chan Event, err error) {
	eng, err := r.pick(req, r.engines)
	if err != nil {
		return "", nil, err
	}
	ch, err := eng.Stream(ctx, req)
	if err != nil {
		return eng.Name(), nil, err
	}
	return eng.Name(), ch, nil
}
