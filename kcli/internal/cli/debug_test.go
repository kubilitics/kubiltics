package cli

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// parseDebugFlags
// ---------------------------------------------------------------------------

func TestParseDebugFlags_NoFlags(t *testing.T) {
	quick, rest := parseDebugFlags([]string{"pod/nginx", "-it"})
	if quick {
		t.Fatal("expected quick=false")
	}
	if len(rest) != 2 {
		t.Fatalf("expected 2 remaining args, got %v", rest)
	}
}

func TestParseDebugFlags_Quick(t *testing.T) {
	quick, rest := parseDebugFlags([]string{"--quick", "pod/nginx"})
	if !quick {
		t.Fatal("expected quick=true")
	}
	for _, a := range rest {
		if a == "--quick" {
			t.Fatal("--quick should be stripped from rest")
		}
	}
	if len(rest) != 1 || rest[0] != "pod/nginx" {
		t.Fatalf("expected [pod/nginx], got %v", rest)
	}
}

func TestParseDebugFlags_Empty(t *testing.T) {
	quick, rest := parseDebugFlags(nil)
	if quick {
		t.Fatal("expected quick=false for nil")
	}
	if len(rest) != 0 {
		t.Fatalf("expected empty rest, got %v", rest)
	}
}

// ---------------------------------------------------------------------------
// hasDebugImage
// ---------------------------------------------------------------------------

func TestHasDebugImage_WithEqualsForm(t *testing.T) {
	if !hasDebugImage([]string{"pod/nginx", "--image=busybox"}) {
		t.Fatal("expected true for --image=busybox")
	}
}

func TestHasDebugImage_WithSpaceForm(t *testing.T) {
	if !hasDebugImage([]string{"pod/nginx", "--image", "busybox"}) {
		t.Fatal("expected true for --image busybox")
	}
}

func TestHasDebugImage_WithoutImage(t *testing.T) {
	if hasDebugImage([]string{"pod/nginx", "-it"}) {
		t.Fatal("expected false when --image is absent")
	}
}

func TestHasDebugImage_Empty(t *testing.T) {
	if hasDebugImage(nil) {
		t.Fatal("expected false for nil args")
	}
}

// ---------------------------------------------------------------------------
// pickDebugImage (non-interactive / numeric selection)
// ---------------------------------------------------------------------------

func pickDebugImageFrom(input string) (string, error) {
	a := &app{
		stdin:  strings.NewReader(input),
		stderr: &strings.Builder{},
	}
	return pickDebugImage(a)
}

func TestPickDebugImage_DefaultOnEmpty(t *testing.T) {
	got, err := pickDebugImageFrom("\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != debugImages[0].Image {
		t.Errorf("expected default image %q, got %q", debugImages[0].Image, got)
	}
}

func TestPickDebugImage_SelectFirstByNumber(t *testing.T) {
	got, err := pickDebugImageFrom("1\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != debugImages[0].Image {
		t.Errorf("expected %q, got %q", debugImages[0].Image, got)
	}
}

func TestPickDebugImage_SelectSecondByNumber(t *testing.T) {
	got, err := pickDebugImageFrom("2\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != debugImages[1].Image {
		t.Errorf("expected %q, got %q", debugImages[1].Image, got)
	}
}

func TestPickDebugImage_RawImageNamePassthrough(t *testing.T) {
	// Non-numeric input with ":" is treated as a raw image name.
	got, err := pickDebugImageFrom("myregistry.io/myapp:debug\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "myregistry.io/myapp:debug" {
		t.Errorf("expected raw image passthrough, got %q", got)
	}
}

func TestPickDebugImage_EOFDefaultsToFirst(t *testing.T) {
	// EOF (empty reader) → default image.
	got, err := pickDebugImageFrom("")
	if err != nil {
		t.Fatalf("unexpected error on EOF: %v", err)
	}
	if got != debugImages[0].Image {
		t.Errorf("expected default on EOF, got %q", got)
	}
}

func TestPickDebugImage_InvalidSelectionError(t *testing.T) {
	// Non-numeric, non-image-looking string.
	_, err := pickDebugImageFrom("banana\n")
	if err == nil {
		t.Fatal("expected error for nonsense selection")
	}
}

// ---------------------------------------------------------------------------
// debugImages table sanity
// ---------------------------------------------------------------------------

func TestDebugImages_AllHaveImage(t *testing.T) {
	for i, img := range debugImages {
		if strings.TrimSpace(img.Image) == "" {
			t.Errorf("debugImages[%d] has empty Image", i)
		}
		if strings.TrimSpace(img.Description) == "" {
			t.Errorf("debugImages[%d] has empty Description", i)
		}
	}
}

func TestDebugImages_FirstIsNetshoot(t *testing.T) {
	if !strings.Contains(debugImages[0].Image, "netshoot") {
		t.Errorf("first debug image should be netshoot, got %q", debugImages[0].Image)
	}
}
