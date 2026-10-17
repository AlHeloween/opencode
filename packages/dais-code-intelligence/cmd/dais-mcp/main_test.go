package main

import (
	"bytes"
	"context"
	"testing"
)

func TestInvalidStartupRefused(t *testing.T) {
	for _, args := range [][]string{{}, {"--timeout", "0s"}, {"--max-results", "0"}, {"--max-frame-bytes", "0"}, {"--snapshot", "bad"}, {"--target-revision", "trunk"}, {"--unknown", "x"}} {
		var diagnostics bytes.Buffer
		if err := run(context.Background(), args, &diagnostics); err == nil {
			t.Fatalf("accepted %+v", args)
		}
	}
}
