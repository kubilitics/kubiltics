package supervisor

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/certs"
)

const spawnReadyTimeout = 5 * time.Second

type runningProcess struct {
	cmd    *exec.Cmd
	bundle *certs.Bundle
	port   int
	stdout io.ReadCloser
	done   chan error
}

func (p *runningProcess) kill() {
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
}

func spawnSidecar(ctx context.Context, binaryPath string, args ...string) (*runningProcess, error) {
	bundle, err := certs.Mint()
	if err != nil {
		return nil, fmt.Errorf("mint certs: %w", err)
	}

	cmd := exec.CommandContext(ctx, binaryPath, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}

	if err := certs.WriteStdinBlob(stdin, bundle); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("write certs: %w", err)
	}
	_ = stdin.Close()

	proc := &runningProcess{cmd: cmd, bundle: bundle, stdout: stdout, done: make(chan error, 1)}
	go func() { proc.done <- cmd.Wait() }()

	port, err := waitForReady(stdout, spawnReadyTimeout)
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, err
	}
	proc.port = port
	return proc, nil
}

func waitForReady(r io.Reader, timeout time.Duration) (int, error) {
	type line struct {
		s   string
		err error
	}
	ch := make(chan line, 1)
	go func() {
		sc := bufio.NewScanner(r)
		if sc.Scan() {
			ch <- line{s: sc.Text()}
			return
		}
		if err := sc.Err(); err != nil {
			ch <- line{err: err}
			return
		}
		ch <- line{err: io.EOF}
	}()
	select {
	case l := <-ch:
		if l.err != nil {
			return 0, fmt.Errorf("read ready: %w", l.err)
		}
		if !strings.HasPrefix(l.s, "READY ") {
			return 0, fmt.Errorf("expected READY <port>, got %q", l.s)
		}
		port, err := strconv.Atoi(strings.TrimPrefix(l.s, "READY "))
		if err != nil {
			return 0, fmt.Errorf("parse port: %w", err)
		}
		return port, nil
	case <-time.After(timeout):
		return 0, fmt.Errorf("READY timeout after %s", timeout)
	}
}
