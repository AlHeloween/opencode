package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestReadCommandsRequireExplicitSnapshot(t *testing.T) {
	for _, command := range []string{"facts", "verify", "reference-impact", "export-scs", "export-scip"} {
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

func TestImpactCLIInvalidScopeHasNoEffects(t *testing.T) {
	for _, extra := range [][]string{nil, {"--before-snapshot", "id"}, {"--before-snapshot", "id", "--before-target-revision", "trunk"}, {"--max-response-bytes", "0"}} {
		indexRoot := filepath.Join(t.TempDir(), "must-not-be-created")
		args := append([]string{"reference-impact", "--index-root", indexRoot, "--repository-id", "fixture", "--snapshot", "id"}, extra...)
		var out, diagnostics bytes.Buffer
		if err := run(context.Background(), args, &out, &diagnostics); err == nil || out.Len() != 0 {
			t.Fatalf("invalid scope accepted %v", err)
		}
		if _, err := os.Stat(indexRoot); !os.IsNotExist(err) {
			t.Fatalf("invalid scope wrote metadata %v", err)
		}
	}
}

func TestImpactBoundedJSONNeverWritesPartialResponse(t *testing.T) {
	var out bytes.Buffer
	for _, limit := range []int{0, 1, 4} {
		if err := writeBoundedJSON(&out, "Ω", limit); err == nil || out.Len() != 0 {
			t.Fatalf("unbounded/partial JSON %d %v %q", limit, err, out.String())
		}
	}
	if err := writeBoundedJSON(&out, "Ω", 5); err != nil || out.String() != "\"Ω\"\n" {
		t.Fatalf("exact byte bound %q %v", out.String(), err)
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
