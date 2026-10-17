package search

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"dais.local/codeintelligence/internal/fossil"
)

type fixture struct {
	t                            *testing.T
	root, repo, home, executable string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{t: t, executable: os.Getenv("DAIS_TEST_FOSSIL")}
	if f.executable == "" {
		t.Fatal("DAIS_TEST_FOSSIL must name the real Fossil executable")
	}
	dir := t.TempDir()
	f.root = filepath.Join(dir, "checkout")
	f.home = filepath.Join(dir, "home")
	f.repo = filepath.Join(dir, "repo.fsl")
	for _, p := range []string{f.root, f.home} {
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.run("init", f.repo)
	f.run("open", f.repo, "--nested")
	return f
}
func (f *fixture) run(args ...string) {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, f.executable, args...)
	c.Dir = f.root
	c.Env = append(os.Environ(), "FOSSIL_HOME="+f.home)
	if b, e := c.CombinedOutput(); e != nil {
		f.t.Fatalf("fossil %v: %v %s", args, e, b)
	}
}
func (f *fixture) put(name, text string) {
	f.t.Helper()
	p := filepath.Join(f.root, filepath.FromSlash(name))
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		f.t.Fatal(e)
	}
	if e := os.WriteFile(p, []byte(text), 0600); e != nil {
		f.t.Fatal(e)
	}
}
func (f *fixture) provider() *fossil.Provider {
	f.t.Helper()
	p, e := fossil.New(fossil.Config{Executable: f.executable, Repository: f.repo, FossilHome: f.home, HeadRef: "trunk", Timeout: 10 * time.Second, MaxOutputBytes: 4 << 20})
	if e != nil {
		f.t.Fatal(e)
	}
	return p
}
func (f *fixture) commit(comment string) fossil.Revision {
	f.t.Helper()
	f.run("addremove")
	f.run("commit", "-m", comment, "--hash", "--no-warnings", "--no-prompt", "--nosign", "--nosync", "--allow-empty")
	r, e := f.provider().Head(context.Background())
	if e != nil {
		f.t.Fatal(e)
	}
	return r
}
func newIndexRoot(t *testing.T, name string) string {
	t.Helper()
	dir := t.TempDir()
	// Register retirement before adapter cleanups so every shared searcher closes first.
	t.Cleanup(func() {
		deadline := time.Now().Add(3 * time.Second)
		for {
			runtime.GC()
			if e := os.RemoveAll(dir); e == nil {
				break
			} else if time.Now().After(deadline) {
				t.Errorf("mapped fixture generation did not retire: %v", e)
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
	})
	return filepath.Join(dir, name)
}
func openAdapter(t *testing.T, c Config) *Adapter {
	t.Helper()
	a, e := New(c)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if e := a.Close(); e != nil {
			t.Error(e)
		}
	})
	return a
}
func matches(t *testing.T, a *Adapter, kind, q string) Response {
	t.Helper()
	r, e := a.Search(context.Background(), Request{Kind: kind, Query: q})
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func addresses(r Response) []string {
	out := []string{}
	for _, m := range r.Results {
		out = append(out, m.Path+":"+m.Content)
	}
	sort.Strings(out)
	return out
}

func TestCanonicalHistoricalProvenance(t *testing.T) {
	f := newFixture(t)
	f.put("one.go", "HistoricalToken\n")
	original := f.commit("historical sv:0123456789abcdef0123456789abcdef")
	f.put("one.go", "CurrentToken\n")
	f.commit("new head without SV")
	a := openAdapter(t, Config{IndexRoot: newIndexRoot(t, "canonical"), RepositoryID: "fixture", Provider: f.provider()})
	forged := original
	forged.Comment = "caller forged sv:ffffffffffffffffffffffffffffffff"
	snapshot, err := a.Index(context.Background(), forged, "full")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SVRef != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("caller comment replaced canonical historical SV: %+v", snapshot)
	}
	r := matches(t, a, "code", "HistoricalToken")
	if len(r.Results) != 1 || r.Results[0].Revision != original.Hash || r.Results[0].SVRef != snapshot.SVRef {
		t.Fatalf("historical provenance: %+v", r)
	}
}

func TestUnsignedSVAndCurrentSearcherRetention(t *testing.T) {
	f := newFixture(t)
	f.put("one.go", "StableToken\n")
	r := f.commit("unsigned")
	a := openAdapter(t, Config{IndexRoot: newIndexRoot(t, "unsigned"), RepositoryID: "fixture", Provider: f.provider()})
	snapshot, err := a.Index(context.Background(), r, "full")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SVRef != "" {
		t.Errorf("unsigned revision invented SV %q", snapshot.SVRef)
	}
	for range 3 {
		r = f.commit("unsigned no-op")
		snapshot, err = a.Index(context.Background(), r, "delta")
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(a.searchers) != 1 || a.searchers[snapshot.Generation] == nil {
		t.Fatalf("retained %d searchers instead of current %s", len(a.searchers), snapshot.Generation)
	}
}

func TestSerializedResponseByteBound(t *testing.T) {
	f := newFixture(t)
	f.put("one.go", "EscapedToken"+strings.Repeat("\"", 500)+"\n")
	r := f.commit("response bounds")
	c := Config{IndexRoot: newIndexRoot(t, "bounds"), RepositoryID: "fixture", Provider: f.provider()}
	a := openAdapter(t, c)
	if _, err := a.Index(context.Background(), r, "full"); err != nil {
		t.Fatal(err)
	}
	for _, bound := range []int{1, 1024, 8192} {
		t.Run(fmt.Sprintf("bytes-%d", bound), func(t *testing.T) {
			limited := c
			limited.MaxResponseBytes = bound
			reader := openAdapter(t, limited)
			response, err := reader.Search(context.Background(), Request{Kind: "code", Query: "EscapedToken"})
			if err != nil {
				if bound == 8192 || !strings.Contains(err.Error(), "MaxResponseBytes") {
					t.Fatal(err)
				}
				return
			}
			encoded, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			if len(encoded) > bound {
				t.Fatalf("accepted %d serialized bytes above bound %d", len(encoded), bound)
			}
			if bound == 1 {
				t.Fatal("metadata should not fit in one byte")
			}
			if bound == 8192 && (len(response.Results) != 1 || !response.Complete) {
				t.Fatalf("ample bound dropped match: %+v", response)
			}
			if len(response.Results) == 0 && !response.Truncated {
				t.Fatal("byte truncation not reported")
			}
		})
	}
}

func TestFullDeltaRevisionAndReopen(t *testing.T) {
	f := newFixture(t)
	f.put("old.go", "package fixture\nvar OldToken = 1\nvar CommonToken = 2\n")
	f.put("delete.go", "CommonToken DeletedToken\n")
	f.put("строка space.go", "CommonToken UnicodeToken\n")
	f.put("generated/skip.go", "CommonToken ExcludedToken\n")
	f.put("binary.dat", "CommonToken\x00binary")
	f.put("large.go", strings.Repeat("CommonToken", 100))
	ra := f.commit("base sv:0123456789abcdef0123456789abcdef")
	c := Config{IndexRoot: newIndexRoot(t, "index"), RepositoryID: "fixture", Provider: f.provider(), Exclude: []string{"generated/**"}, MaxFileBytes: 512}
	a := openAdapter(t, c)
	before, e := os.ReadFile(f.repo)
	if e != nil {
		t.Fatal(e)
	}
	sa, e := a.Index(context.Background(), ra, "full")
	if e != nil {
		t.Fatal(e)
	}
	if sa.IndexedFiles != 3 || sa.OmittedFiles != 3 {
		t.Fatalf("coverage %+v", sa)
	}
	if r := matches(t, a, "code", "OldToken"); len(r.Results) != 1 || !r.Complete {
		t.Fatalf("A: %+v", r)
	}
	f.run("mv", "--hard", "old.go", "renamed.go")
	if e := os.Remove(filepath.Join(f.root, "delete.go")); e != nil {
		t.Fatal(e)
	}
	f.put("renamed.go", "package fixture\nvar NewToken = 1\nvar CommonToken = 3\n")
	f.put("new.go", "CommonToken AddedToken\n")
	rb := f.commit("changed sv:11111111111111111111111111111111")
	// The stale control fails the freshness predicate before publication.
	if st, e := a.Status(context.Background()); e != nil || st.Revision == rb.Hash {
		t.Fatalf("stale control: %+v %v", st, e)
	}
	sb, e := a.Index(context.Background(), rb, "delta")
	if e != nil {
		t.Fatal(e)
	}
	fullConfig := c
	fullConfig.IndexRoot = newIndexRoot(t, "full")
	b := openAdapter(t, fullConfig)
	if _, e := b.Index(context.Background(), rb, "full"); e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"CommonToken", "NewToken", "UnicodeToken", "OldToken", "DeletedToken", "ExcludedToken", "ABSENT_SENTINEL_9284"} {
		r := matches(t, a, "code", q)
		s := matches(t, b, "code", q)
		if !reflect.DeepEqual(addresses(r), addresses(s)) {
			t.Fatalf("delta/full %q: %v / %v", q, addresses(r), addresses(s))
		}
		for _, m := range r.Results {
			if m.Revision != rb.Hash || m.Generation != sb.Generation || m.ArtifactHash == "" || m.SVRef != "11111111111111111111111111111111" {
				t.Fatalf("address %+v", m)
			}
		}
	}
	if r := matches(t, a, "filename", "renamed.go"); len(r.Results) != 1 || r.Results[0].Path != "renamed.go" {
		t.Fatalf("filename %+v", r)
	}
	if r := matches(t, a, "regex", "(New|Added)Token"); len(r.Results) != 2 {
		t.Fatalf("regex %+v", r)
	}
	if r := matches(t, a, "symbol_text", "NewToken"); len(r.Results) != 1 {
		t.Fatalf("symbol text %+v", r)
	}
	rc := f.commit("no-op sv:22222222222222222222222222222222")
	sc, e := a.Index(context.Background(), rc, "delta")
	if e != nil {
		t.Fatal(e)
	}
	if sc.Revision != rc.Hash || sc.SVRef != "22222222222222222222222222222222" {
		t.Fatalf("noop %+v", sc)
	}
	offline := c
	offline.Provider = nil
	d := openAdapter(t, offline)
	if r := matches(t, d, "code", "NewToken"); len(r.Results) != 1 || r.Snapshot.Revision != rc.Hash {
		t.Fatalf("reopen %+v", r)
	}
	// Provider reads do not alter Fossil; the two intentional fixture commits do.
	after, e := os.ReadFile(f.repo)
	if e != nil {
		t.Fatal(e)
	}
	if reflect.DeepEqual(before, after) {
		t.Fatal("fixture commits did not change source repository")
	}
	baseline := append([]byte(nil), after...)
	if _, e := d.Search(context.Background(), Request{Kind: "code", Query: "NewToken"}); e != nil {
		t.Fatal(e)
	}
	after, e = os.ReadFile(f.repo)
	if e != nil || !reflect.DeepEqual(baseline, after) {
		t.Fatal("search modified Fossil")
	}
}

func TestLimitsCancellationConfigAndFailedPublication(t *testing.T) {
	f := newFixture(t)
	f.put("one.go", "HitToken\nHitToken\nHitToken\n")
	ra := f.commit("base")
	c := Config{IndexRoot: newIndexRoot(t, "index"), RepositoryID: "fixture", Provider: f.provider(), MaxResults: 2, MaxQueryBytes: 64}
	a := openAdapter(t, c)
	sa, e := a.Index(context.Background(), ra, "full")
	if e != nil {
		t.Fatal(e)
	}
	r := matches(t, a, "code", "HitToken")
	if len(r.Results) != 2 || r.Complete || !r.Truncated {
		t.Fatalf("limit %+v", r)
	}
	for _, req := range []Request{{Kind: "bad", Query: "x"}, {Kind: "regex", Query: "["}, {Kind: "code", Query: strings.Repeat("a", 65)}} {
		if _, e := a.Search(context.Background(), req); e == nil {
			t.Fatalf("accepted %+v", req)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := a.Search(ctx, Request{Kind: "code", Query: "HitToken"}); !errors.Is(e, context.Canceled) {
		t.Fatalf("search cancel %v", e)
	}
	if _, e := a.Index(ctx, ra, "delta"); !errors.Is(e, context.Canceled) {
		t.Fatalf("index cancel %v", e)
	}
	bad := ra
	bad.Hash = strings.Repeat("f", 64)
	if _, e := a.Index(context.Background(), bad, "full"); e == nil {
		t.Fatal("accepted invalid revision")
	}
	changed := c
	changed.Exclude = []string{"*.go"}
	other := openAdapter(t, changed)
	if _, e := other.Index(context.Background(), ra, "delta"); !errors.Is(e, ErrConfigMismatch) {
		t.Fatalf("config mismatch %v", e)
	}
	db, e := sql.Open("sqlite", filepath.Join(c.IndexRoot, "metadata.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec("CREATE TRIGGER reject_publication BEFORE UPDATE ON current BEGIN SELECT RAISE(ABORT,'publication oracle'); END"); e != nil {
		t.Fatal(e)
	}
	f.put("one.go", "ReplacementToken\n")
	rb := f.commit("changed")
	if _, e := a.Index(context.Background(), rb, "delta"); e == nil {
		t.Fatal("publication failure accepted")
	}
	var current string
	if e := db.QueryRow("SELECT generation FROM current WHERE id=1").Scan(&current); e != nil || current != sa.Generation {
		t.Fatalf("persistent current %s %v", current, e)
	}
	if st, e := a.Status(context.Background()); e != nil || st.Generation != sa.Generation || st.Revision != ra.Hash {
		t.Fatalf("failed publication changed status %+v %v", st, e)
	}
	if _, e = db.Exec("DROP TRIGGER reject_publication"); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Index(context.Background(), rb, "delta"); e != nil {
		t.Fatal(e)
	}
	if r := matches(t, a, "code", "HitToken"); len(r.Results) != 0 {
		t.Fatalf("stale after update %+v", r)
	}
	if r := matches(t, a, "code", "ReplacementToken"); len(r.Results) != 1 {
		t.Fatalf("resume %+v", r)
	}
}
