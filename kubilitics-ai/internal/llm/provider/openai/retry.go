// Package-level retry helper for the OpenAI client. Retries on 429
// (rate-limit) and 5xx (transient server errors). 2xx returns immediately;
// 4xx != 429 passes through without retry (client error).
//
// Backoff: 100ms × 2^n for 5xx with jitter up to 50ms. For 429 we honor
// either the standard Retry-After header (HTTP seconds or HTTP-date) OR
// the "Please try again in X ms/s" hint OpenAI embeds in the body.
//
// Max attempts is inclusive of the initial call: maxAttempts=3 means 1
// initial + up to 2 retries.
package openai

import (
	"bytes"
	"io"
	"math"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const (
	defaultRetryBaseDelay    = 200 * time.Millisecond
	defaultMaxRetryDelay     = 30 * time.Second
	default5xxBackoffBase    = 100 * time.Millisecond
	default5xxBackoffJitter  = 50 * time.Millisecond
)

var retryAfterRE = regexp.MustCompile(`try again in\s+(\d+(?:\.\d+)?)(ms|s)`)

func doWithRetryOn429(client *http.Client, req *http.Request, maxAttempts int) (*http.Response, error) {
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	var bodyBytes []byte
	if req.Body != nil {
		b, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		_ = req.Body.Close()
		bodyBytes = b
	}

	var lastResp *http.Response
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if bodyBytes != nil {
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			req.ContentLength = int64(len(bodyBytes))
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		// 2xx or 4xx != 429 → return immediately (no retry).
		retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		if !retryable {
			return resp, nil
		}
		lastResp = resp
		if attempt == maxAttempts {
			break
		}
		var wait time.Duration
		if resp.StatusCode == http.StatusTooManyRequests {
			// Prefer the standard Retry-After header, then the body hint,
			// then exponential backoff as a floor.
			wait = parseRetryAfterHeader(resp.Header.Get("Retry-After"))
			if wait <= 0 {
				peek, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
				wait = parseRetryAfterMs(bytes.NewReader(peek))
			}
			if wait <= 0 {
				wait = time.Duration(math.Pow(2, float64(attempt-1))) * defaultRetryBaseDelay
			}
		} else {
			// 5xx: exp-backoff 100ms × 2^(n-1) + jitter up to 50ms.
			base := time.Duration(math.Pow(2, float64(attempt-1))) * default5xxBackoffBase
			jitter := time.Duration(rand.Int63n(int64(default5xxBackoffJitter) + 1))
			wait = base + jitter
		}
		_ = resp.Body.Close()
		if wait > defaultMaxRetryDelay {
			wait = defaultMaxRetryDelay
		}
		time.Sleep(wait)
	}
	return lastResp, nil
}

// parseRetryAfterHeader parses the standard HTTP Retry-After header.
// Supports integer seconds (e.g. "2") and HTTP-date format. Returns 0 on
// parse failure or unparseable input.
func parseRetryAfterHeader(v string) time.Duration {
	if v == "" {
		return 0
	}
	if secs, err := strconv.ParseFloat(v, 64); err == nil && secs >= 0 {
		return time.Duration(secs * float64(time.Second))
	}
	if t, err := http.ParseTime(v); err == nil {
		d := time.Until(t)
		if d > 0 {
			return d
		}
	}
	return 0
}

func parseRetryAfterMs(r io.Reader) time.Duration {
	b, _ := io.ReadAll(r)
	m := retryAfterRE.FindSubmatch(b)
	if len(m) != 3 {
		return 0
	}
	n, err := strconv.ParseFloat(string(m[1]), 64)
	if err != nil {
		return 0
	}
	switch string(m[2]) {
	case "ms":
		return time.Duration(n) * time.Millisecond
	case "s":
		return time.Duration(n*1000) * time.Millisecond
	}
	return 0
}
