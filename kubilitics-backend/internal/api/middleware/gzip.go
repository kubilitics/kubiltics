// Package middleware provides gzip response compression.
// Compresses JSON and text responses over 1KB using Go's standard library.
package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

const gzipMinLength = 1024 // Only compress responses > 1KB

// compressibleTypes are content types worth compressing.
var compressibleTypes = []string{
	"application/json",
	"text/",
	"application/javascript",
	"application/xml",
	"image/svg+xml",
}

var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression)
		return w
	},
}

// Gzip wraps an http.Handler to transparently compress responses
// when the client supports it and the response is large enough.
func Gzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip if client doesn't accept gzip
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		// Skip WebSocket upgrade requests
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			next.ServeHTTP(w, r)
			return
		}

		// Skip SSE (event-stream) — these are long-lived and should not be buffered
		if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
			next.ServeHTTP(w, r)
			return
		}

		gw := &gzipResponseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}
		defer gw.Close()

		next.ServeHTTP(gw, r)
	})
}

// gzipResponseWriter buffers the initial bytes to decide whether to compress.
type gzipResponseWriter struct {
	http.ResponseWriter
	gzWriter   *gzip.Writer
	buf        []byte // buffer until we decide to compress
	statusCode int
	decided    bool // have we committed to compress or passthrough?
	compress   bool // if decided, are we compressing?
}

func (w *gzipResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	if !w.decided {
		// Don't write header yet — we need to see the content type first
		return
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if !w.decided {
		w.buf = append(w.buf, b...)
		if len(w.buf) >= gzipMinLength {
			w.commit()
		}
		return len(b), nil
	}

	if w.compress {
		return w.gzWriter.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

func (w *gzipResponseWriter) commit() {
	w.decided = true

	ct := w.Header().Get("Content-Type")
	if ct == "" {
		ct = http.DetectContentType(w.buf)
	}

	if len(w.buf) >= gzipMinLength && isCompressible(ct) {
		w.compress = true

		// Remove Content-Length since we're changing the encoding
		w.Header().Del("Content-Length")
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")

		w.ResponseWriter.WriteHeader(w.statusCode)

		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(w.ResponseWriter)
		w.gzWriter = gz

		w.gzWriter.Write(w.buf) //nolint:errcheck // flush buffered data
	} else {
		w.ResponseWriter.WriteHeader(w.statusCode)
		w.ResponseWriter.Write(w.buf) //nolint:errcheck // flush buffered data
	}
	w.buf = nil
}

func (w *gzipResponseWriter) Close() {
	if !w.decided {
		w.commit()
	}
	if w.gzWriter != nil {
		w.gzWriter.Close()
		gzipWriterPool.Put(w.gzWriter)
		w.gzWriter = nil
	}
}

// Flush implements http.Flusher for SSE/streaming compatibility.
// Commit must run before the inner Flush so that Content-Encoding is set
// on the headers before they are sent. Without this, a handler that calls
// Flush() before writing any body (e.g. streaming log endpoints) causes the
// inner ResponseWriter to send headers with no Content-Encoding, and then
// commit() later tries to set gzip headers and call WriteHeader again —
// resulting in a "superfluous WriteHeader" warning and a compressed body
// delivered without the Content-Encoding: gzip header (garbled on the client).
func (w *gzipResponseWriter) Flush() {
	if !w.decided {
		w.commit()
	}
	if w.gzWriter != nil {
		w.gzWriter.Flush() //nolint:errcheck
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack implements http.Hijacker for WebSocket compatibility.
func (w *gzipResponseWriter) Hijack() (c interface{}, brw interface{}, err error) {
	if hj, ok := w.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func isCompressible(ct string) bool {
	ct = strings.ToLower(ct)
	for _, prefix := range compressibleTypes {
		if strings.Contains(ct, prefix) {
			return true
		}
	}
	return false
}
