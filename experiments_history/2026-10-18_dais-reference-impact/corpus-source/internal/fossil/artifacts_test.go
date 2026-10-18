package fossil

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestReadArtifactsBatches(t *testing.T) {
	for _, policy := range []string{"default", "sha1"} {
		t.Run(policy, func(t *testing.T) {
			f := newFixture(t)
			if policy == "sha1" {
				f.run("hash-policy", "sha1")
			}
			want := map[string][]byte{"empty": {}, "binary": {0, 255, 13, 10, 0}, "строка space.txt": []byte("line\r\nline\r\n")}
			for name, data := range want {
				f.put(name, data)
			}
			revision := f.commit("batch")
			p := f.provider()
			ctx := context.Background()
			files, err := p.ListFiles(ctx, revision)
			if err != nil {
				t.Fatal(err)
			}
			hashes := make([]string, 0, len(files)+1)
			for _, file := range files {
				if policy == "sha1" && len(file.Hash) != 40 {
					t.Fatalf("hash-policy sha1 produced %q", file.Hash)
				}
				hashes = append(hashes, file.Hash)
			}
			hashes = append(hashes, hashes[0])
			before := mustRead(t, f.repo)
			got, err := p.ReadArtifacts(ctx, hashes)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(files) {
				t.Fatalf("batch result count %d != %d", len(got), len(files))
			}
			for _, file := range files {
				if !bytes.Equal(got[file.Hash], want[file.Path]) {
					t.Fatalf("batch bytes differ for %q", file.Path)
				}
			}
			empty, err := p.ReadArtifacts(ctx, nil)
			if err != nil || empty == nil || len(empty) != 0 {
				t.Fatalf("empty batch=%v err=%v", empty, err)
			}
			for _, invalid := range []string{"trunk", hashes[0][:12], "';DROP TABLE blob;--", ""} {
				if _, err := p.ReadArtifacts(ctx, []string{hashes[0], invalid}); err == nil {
					t.Fatalf("accepted invalid hash %q", invalid)
				}
			}
			if _, err := p.ReadArtifacts(ctx, []string{hashes[0], strings.Repeat("f", 40)}); !errors.Is(err, ErrNotFound) {
				t.Fatalf("missing artifact: %v", err)
			}
			limited := *p
			limited.config.MaxOutputBytes = 8
			if _, err := limited.ReadArtifacts(ctx, hashes); !errors.Is(err, ErrOutputLimit) {
				t.Fatalf("batch output limit: %v", err)
			}
			if !bytes.Equal(before, mustRead(t, f.repo)) {
				t.Fatal("batch queries modified repository")
			}
			// Only this disposable fixture is changed: a known artifact becomes
			// a phantom and must be distinguished from the valid empty file.
			f.run("sql", "-R", f.repo, "UPDATE blob SET size=-1,content=NULL WHERE uuid="+quote(hashes[0]))
			phantomBefore := mustRead(t, f.repo)
			if _, err := p.ReadArtifacts(ctx, hashes); !errors.Is(err, ErrNotFound) {
				t.Fatalf("phantom artifact: %v", err)
			}
			if !bytes.Equal(phantomBefore, mustRead(t, f.repo)) {
				t.Fatal("phantom query modified repository")
			}
		})
	}
}
