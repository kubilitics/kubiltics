package api

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/kubilitics/kcli/internal/cli"
)

type Config struct {
	Stdin io.Reader
	Env   map[string]string
}

type StreamChunk struct {
	Stream string
	Data   string
	Done   bool
	Err    error
}

type Client struct {
	cfg Config
	mu  sync.Mutex
}

func NewKCLI(cfg Config) *Client {
	return &Client{cfg: cfg}
}

func (c *Client) Execute(command string) (string, error) {
	args := parseCommand(command)
	if len(args) == 0 {
		return "", fmt.Errorf("empty command")
	}
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	err := c.executeArgs(context.Background(), args, stdout, stderr)
	out := strings.TrimSpace(stdout.String())
	errOut := strings.TrimSpace(stderr.String())
	if err != nil {
		if errOut != "" {
			return strings.TrimSpace(out + "\n" + errOut), err
		}
		return out, err
	}
	if errOut != "" {
		if out != "" {
			return out + "\n" + errOut, nil
		}
		return errOut, nil
	}
	return out, nil
}

func (c *Client) ExecuteStream(command string) (<-chan StreamChunk, error) {
	args := parseCommand(command)
	if len(args) == 0 {
		return nil, fmt.Errorf("empty command")
	}
	outR, outW := io.Pipe()
	errR, errW := io.Pipe()
	ch := make(chan StreamChunk, 64)

	// wg tracks the two streamPipe goroutines so we can wait for them to
	// drain their respective pipes before sending the Done sentinel and
	// closing the channel. Without this synchronisation the main goroutine
	// could close(ch) while a streamPipe goroutine is still sending, causing
	// a data race detected by the Go race detector.
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		streamPipe("stdout", outR, ch)
	}()
	go func() {
		defer wg.Done()
		streamPipe("stderr", errR, ch)
	}()

	go func() {
		err := c.executeArgs(context.Background(), args, outW, errW)
		// Close the write ends of the pipes so that streamPipe goroutines
		// reach EOF and their scanners exit cleanly.
		_ = outW.Close()
		_ = errW.Close()
		// Wait for both streamPipe goroutines to finish sending before we
		// send the Done sentinel and close the channel.
		wg.Wait()
		ch <- StreamChunk{Done: true, Err: err}
		close(ch)
	}()

	return ch, nil
}

func (c *Client) executeArgs(_ context.Context, args []string, out, errOut io.Writer) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	restore := c.applyEnv()
	defer restore()

	in := c.cfg.Stdin
	if in == nil {
		in = bytes.NewReader(nil)
	}
	root := cli.NewRootCommandWithIO(in, out, errOut)
	root.SetArgs(args)
	return root.Execute()
}

func (c *Client) applyEnv() func() {
	if len(c.cfg.Env) == 0 {
		return func() {}
	}
	prev := map[string]*string{}
	for k, v := range c.cfg.Env {
		if old, ok := lookupEnv(k); ok {
			ov := old
			prev[k] = &ov
		} else {
			prev[k] = nil
		}
		_ = setEnv(k, v)
	}
	return func() {
		for k, v := range prev {
			if v == nil {
				_ = unsetEnv(k)
			} else {
				_ = setEnv(k, *v)
			}
		}
	}
}

var (
	lookupEnv = os.LookupEnv
	setEnv    = os.Setenv
	unsetEnv  = os.Unsetenv
)

func parseCommand(command string) []string {
	fields := strings.Fields(strings.TrimSpace(command))
	if len(fields) == 0 {
		return nil
	}
	if fields[0] == "kcli" {
		return fields[1:]
	}
	return fields
}

func streamPipe(stream string, r io.Reader, ch chan<- StreamChunk) {
	s := bufio.NewScanner(r)
	for s.Scan() {
		line := s.Text()
		ch <- StreamChunk{Stream: stream, Data: line}
	}
}
