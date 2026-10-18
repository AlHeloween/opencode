package fossil

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type fixture struct {
	t                            *testing.T
	executable, root, repo, home string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	executable := os.Getenv("DAIS_TEST_FOSSIL")
	if executable == "" {
		var err error
		executable, err = exec.LookPath("fossil")
		if err != nil {
			t.Fatal("real Fossil executable required: set DAIS_TEST_FOSSIL", err)
		}
	}
	root := t.TempDir()
	f := &fixture{t: t, executable: executable, root: filepath.Join(root, "checkout"), repo: filepath.Join(root, "repo.fsl"), home: filepath.Join(root, "home")}
	for _, dir := range []string{f.root, f.home} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.run("init", f.repo)
	f.run("open", f.repo, "--nested")
	return f
}

func (f *fixture) run(args ...string) []byte {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, f.executable, args...)
	cmd.Dir = f.root
	cmd.Env = append(os.Environ(), "FOSSIL_HOME="+f.home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		f.t.Fatalf("fossil %v: %v\n%s", args, err, out)
	}
	return out
}

func (f *fixture) put(name string, data []byte) {
	f.t.Helper()
	path := filepath.Join(f.root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) commit(comment string) string {
	f.t.Helper()
	f.run("addremove")
	f.run("commit", "-m", comment, "--no-warnings", "--no-prompt", "--nosign", "--nosync", "--allow-empty")
	p := f.provider()
	rev, err := p.Head(context.Background())
	if err != nil {
		f.t.Fatal(err)
	}
	return rev.Hash
}

func (f *fixture) provider() *Provider {
	f.t.Helper()
	p, err := New(Config{Executable: f.executable, Repository: f.repo, HeadRef: "trunk", FossilHome: f.home, Timeout: 10 * time.Second, MaxOutputBytes: 4 << 20})
	if err != nil {
		f.t.Fatal(err)
	}
	return p
}

func TestProviderRevisionTrees(t *testing.T) {
	f := newFixture(t)
	a := map[string][]byte{"empty": {}, "binary": {0, 255, 13, 10, 0}, "строка space.txt": []byte("a\r\nb\r\n"), "old.txt": []byte("same"), "copy.txt": []byte("same")}
	for path, data := range a {
		f.put(path, data)
	}
	ra := f.commit("base sv:0123456789abcdef0123456789abcdef")
	f.run("mv", "old.txt", "renamed.txt")
	if err := os.Rename(filepath.Join(f.root, "old.txt"), filepath.Join(f.root, "renamed.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(f.root, "empty")); err != nil {
		t.Fatal(err)
	}
	f.put("binary", []byte{1, 0, 2})
	f.put("added.txt", []byte("new"))
	rb := f.commit("changed")
	b := map[string][]byte{"binary": {1, 0, 2}, "строка space.txt": a["строка space.txt"], "renamed.txt": []byte("same"), "copy.txt": []byte("same"), "added.txt": []byte("new")}
	f.put("third.txt", []byte("third"))
	rc := f.commit("third")
	c := cloneBytes(b)
	c["third.txt"] = []byte("third")
	f.run("branch", "new", "feature", ra)
	f.run("update", "feature")
	f.put("branch.txt", []byte("branch"))
	f.run("addremove")
	f.run("commit", "-m", "branch", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	branchProvider, err := New(Config{Executable: f.executable, Repository: f.repo, HeadRef: "feature", FossilHome: f.home, Timeout: 10 * time.Second, MaxOutputBytes: 4 << 20})
	if err != nil {
		t.Fatal(err)
	}
	branch, err := branchProvider.Head(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	d := cloneBytes(a)
	d["branch.txt"] = []byte("branch")
	f.run("update", "trunk")
	f.run("merge", "feature")
	rm := f.commit("merge")
	m := cloneBytes(c)
	m["branch.txt"] = []byte("branch")
	p := f.provider()
	ctx := context.Background()
	head, err := p.Head(ctx)
	if err != nil || head.Hash != rm || head.Comment != "merge" {
		t.Fatalf("Head=%+v %v", head, err)
	}
	infoBefore := f.run("info")
	dbBefore := mustRead(t, f.repo)
	// A dirty checkout must never replace a pinned revision's contents.
	f.put("binary", []byte("dirty checkout"))
	revisions := []string{ra, rb, rc, branch.Hash, rm}
	expected := []map[string][]byte{a, b, c, d, m}
	for i, rev := range revisions {
		files, err := p.ListFiles(ctx, rev)
		if err != nil {
			t.Fatal(err)
		}
		if len(files) != len(expected[i]) {
			t.Fatalf("tree %d length=%d want=%d", i, len(files), len(expected[i]))
		}
		for _, file := range files {
			want, ok := expected[i][file.Path]
			if !ok {
				t.Fatalf("unexpected path %q", file.Path)
			}
			got, err := p.ReadFile(ctx, rev, file.Path)
			if err != nil || !bytes.Equal(got, want) {
				t.Fatalf("revision=%d path=%q got=%v want=%v err=%v", i, file.Path, got, want, err)
			}
		}
		for j, to := range revisions {
			changes, err := p.Changes(ctx, rev, to)
			if err != nil {
				t.Fatal(err)
			}
			tree := cloneBytes(expected[i])
			for _, ch := range changes {
				switch ch.Kind {
				case Deleted:
					delete(tree, ch.Path)
				case Added, Modified:
					data, err := p.ReadFile(ctx, to, ch.Path)
					if err != nil {
						t.Fatal(err)
					}
					tree[ch.Path] = data
				default:
					t.Fatalf("unknown change kind %q", ch.Kind)
				}
			}
			if !reflect.DeepEqual(tree, expected[j]) {
				t.Fatalf("delta %d -> %d mismatch", i, j)
			}
		}
	}
	if !bytes.Equal(dbBefore, mustRead(t, f.repo)) {
		t.Fatal("provider modified repository")
	}
	if !bytes.Equal(infoBefore, f.run("info")) {
		t.Fatal("provider changed checkout revision")
	}
	if string(mustRead(t, filepath.Join(f.root, "binary"))) != "dirty checkout" {
		t.Fatal("provider changed dirty checkout")
	}
	changes, err := p.Changes(ctx, ra, rb)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]ChangeKind{}
	for _, ch := range changes {
		kinds[ch.Path] = ch.Kind
	}
	if kinds["old.txt"] != Deleted || kinds["renamed.txt"] != Added {
		t.Fatalf("rename is not conservative delete+add: %v", kinds)
	}
}

func TestProviderRejectsInvalidInputs(t *testing.T) {
	f := newFixture(t)
	f.put("file", []byte("data"))
	rev := f.commit("base")
	p := f.provider()
	ctx := context.Background()
	for _, bad := range []string{"trunk", rev[:12], strings.Repeat("f", 40), "';DROP TABLE blob;--", ""} {
		if _, err := p.ListFiles(ctx, bad); err == nil {
			t.Fatalf("accepted revision %q", bad)
		}
	}
	files, err := p.ListFiles(ctx, rev)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.ListFiles(ctx, files[0].Hash); err == nil {
		t.Fatal("accepted file artifact as check-in")
	}
	for _, bad := range []string{"missing", "../file", "/file", "C:/file", "file\\child", "a//b", "./file"} {
		if _, err := p.ReadFile(ctx, rev, bad); err == nil {
			t.Fatalf("accepted path %q", bad)
		}
	}
	injection, err := New(Config{Executable: f.executable, Repository: f.repo, HeadRef: "trunk');DELETE FROM blob;--", FossilHome: f.home, Timeout: time.Second, MaxOutputBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	before := sha256.Sum256(mustRead(t, f.repo))
	if _, err := injection.Head(ctx); err == nil {
		t.Fatal("accepted nonexistent injected ref")
	}
	if before != sha256.Sum256(mustRead(t, f.repo)) {
		t.Fatal("injected ref modified repository")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := p.Head(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	limited, err := New(Config{Executable: f.executable, Repository: f.repo, HeadRef: "trunk", FossilHome: f.home, Timeout: time.Second, MaxOutputBytes: 8})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := limited.Head(ctx); !errors.Is(err, ErrOutputLimit) {
		t.Fatalf("output bound: %v", err)
	}
}

func TestProviderRejectsSQLDiagnosticsAndDeadline(t *testing.T) {
	f := newFixture(t)
	f.put("file", []byte("data"))
	f.commit("base")
	p := f.provider()
	before := mustRead(t, f.repo)
	var rows []Revision
	// The shipped SQLite shell may exit zero for a failed write. Its stderr
	// must invalidate the result and the repository must remain byte-identical.
	if err := p.query(context.Background(), "UPDATE config SET value='unexpected' WHERE name='hash-policy'", &rows); err == nil {
		t.Fatal("read-only write diagnostic was accepted")
	}
	if !bytes.Equal(before, mustRead(t, f.repo)) {
		t.Fatal("read-only SQL query changed the repository")
	}
	if err := p.query(context.Background(), "SELECT 1 AS unexpected_field", &rows); err == nil {
		t.Fatal("unexpected JSON schema was accepted")
	}
	p.config.Timeout = time.Nanosecond
	if _, err := p.Head(context.Background()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("command deadline: %v", err)
	}
}

func cloneBytes(in map[string][]byte) map[string][]byte {
	out := map[string][]byte{}
	for k, v := range in {
		out[k] = append([]byte{}, v...)
	}
	return out
}
func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
