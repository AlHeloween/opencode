package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInvalidCaptureDoesNotCreateBundle(t *testing.T) {
	for _, args := range [][]string{
		{"--timeout", "0s"},
		{"--max-files", "0"},
		{"--ref", "trunk"},
		{"--indexer-sha256", "unverified"},
	} {
		t.Run(args[0], func(t *testing.T) {
			bundle := filepath.Join(t.TempDir(), "bundle")
			var out, diagnostics bytes.Buffer
			valid := []string{"--bundle", bundle, "--ref", strings.Repeat("a", 64), "--indexer-sha256", strings.Repeat("b", 64)}
			err := run(context.Background(), append(valid, args...), &out, &diagnostics)
			if err == nil {
				t.Fatal("invalid configuration was accepted")
			}
			if _, err := os.Stat(bundle); !os.IsNotExist(err) {
				t.Fatalf("invalid command created bundle: %v", err)
			}
			if out.Len() != 0 {
				t.Fatalf("invalid pre-execution configuration emitted a receipt: %s", out.String())
			}
		})
	}
}
