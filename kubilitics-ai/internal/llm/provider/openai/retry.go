// Package-level retry helper for the OpenAI client. Only 429 is retried;
// every other status (2xx, 4xx≠429, 5xx) passes through for the caller to
// handle. Honors the "Please try again in X ms" hint OpenAI ships in the
// 429 body; falls back to exponential backoff (200ms, 400ms, 800ms).
//
// Max attempts is inclusive of the initial call: maxAttempts=3 means 1
// initial + up to 2 retries.
package openai

import (
	"bytes"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const (
	defaultRetryBaseDelay = 200 * time.Millisecond
	defaultMaxRetryDelay  = 30 * time.Second
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
		if resp.StatusCode != http.StatusTooManyRequests {
			return resp, nil
		}
		lastResp = resp
		if attempt == maxAttempts {
			break
		}
		peek, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		_ = resp.Body.Close()
		wait := parseRetryAfterMs(bytes.NewReader(peek))
		if wait <= 0 {
			wait = time.Duration(math.Pow(2, float64(attempt-1))) * defaultRetryBaseDelay
		}
		if wait > defaultMaxRetryDelay {
			wait = defaultMaxRetryDelay
		}
		time.Sleep(wait)
	}
	return lastResp, nil
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
