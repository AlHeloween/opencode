package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestReadCommandsRequireExplicitSnapshot(t *testing.T) {
	for _, command := range []string{"facts", "verify", "export-scs", "export-scip"} {
		t.Run(command, func(t *testing.T) {
			indexRoot := filepath.Join(t.TempDir(), "must-not-be-created")
			var out, diagnostics bytes.Buffer
			err := run(context.Background(), []string{command, "--index-root", indexRoot, "--repository-id", "fixture"}, &out, &diagnostics)
			if err == nil || out.Len() != 0 {
				t.Fatalf("missing snapshot accepted: %v %s", err, out.String())
			}
			if _, err := os.Stat(indexRoot); !os.IsNotExist(err) {
				t.Fatalf("invalid request changed filesystem: %v", err)
			}
		})
	}
}

func TestInvalidBoundsHaveNoPersistentEffects(t *testing.T) {
	for _, flags := range [][]string{{"--limit", "0"}, {"--max-facts", "-1"}, {"--timeout", "0s"}, {"--max-index-bytes", "0"}} {
		indexRoot := filepath.Join(t.TempDir(), "must-not-be-created")
		args := append([]string{"facts", "--index-root", indexRoot, "--repository-id", "fixture", "--snapshot", "id"}, flags...)
		var out, diagnostics bytes.Buffer
		if err := run(context.Background(), args, &out, &diagnostics); err == nil {
			t.Fatalf("accepted invalid bounds: %v", flags)
		}
		if _, err := os.Stat(indexRoot); !os.IsNotExist(err) {
			t.Fatalf("invalid bounds changed filesystem: %v", err)
		}
	}
}
