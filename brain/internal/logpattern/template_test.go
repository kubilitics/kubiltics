package logpattern

import "testing"

func TestExtract_CanonicalLines(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"redis_conn_refused", "2026-04-23T14:01:03Z ERROR connection refused to 10.0.2.14:6379", "{TS} ERROR connection refused to {IP}:{PORT}"},
		{"http_500", "2026-04-23T14:05:11Z WARN HTTP 502 from upstream api.internal", "{TS} WARN HTTP 502 from upstream api.internal"},
		{"uuid_trace", "trace_id=7b8a9cde-1234-5678-9abc-def012345678 took 42ms", "trace_id={UUID} took 42ms"},
		{"pod_suffix", "worker-7f5c8d9a-abcde", "worker-{POD}"},
		{"hex_token", "session=deadbeef0011aabbccdd user=koti", "session={HEX} user=koti"},
		{"long_decimal", "request_id=8273615249 payload_size=12345", "request_id={NUM} payload_size={NUM}"},
		{"plain_message", "worker started", "worker started"},
		{"stacktrace_first_line", "Exception in thread main java.lang.NullPointerException", "Exception in thread main java.lang.NullPointerException"},
		{"iso_ts_with_ms", "2026-04-23T14:05:11.412Z INFO ready", "{TS} INFO ready"},
		{"nginx_access", "10.0.2.14 - - [23/Apr/2026:14:05:11 +0000] \"GET /health HTTP/1.1\" 200 17", "{IP} - - [23/Apr/2026:14:05:11 +0000] \"GET /health HTTP/1.1\" 200 17"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _ := Extract(c.in)
			if got != c.want {
				t.Fatalf("Extract(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestExtract_IdempotencyOnAlreadyTemplated(t *testing.T) {
	in := "{TS} ERROR connection refused to {IP}:{PORT}"
	got, _ := Extract(in)
	if got != in {
		t.Fatalf("idempotency broken: Extract(%q) = %q", in, got)
	}
}
