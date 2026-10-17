package evidencegraph

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dais.local/codeintelligence/internal/fossil"
	wire "dais.local/codeintelligence/internal/scipwire"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

type graphFixture struct {
	t                                *testing.T
	executable, repo, home, checkout string
	sources                          map[string][]byte
	index                            *wire.Index
}

func newGraphFixture(t *testing.T) *graphFixture {
	t.Helper()
	exe := os.Getenv("DAIS_TEST_FOSSIL")
	if exe == "" {
		var err error
		exe, err = exec.LookPath("fossil")
		if err != nil {
			t.Fatal(err)
		}
	}
	root := t.TempDir()
	f := &graphFixture{t: t, executable: exe, repo: filepath.Join(root, "repo.fsl"), home: filepath.Join(root, "home"), checkout: filepath.Join(root, "checkout"), sources: map[string][]byte{"a.go": []byte("😀 Привет\r\nfunc alpha() {}\r\n"), "b.go": []byte("var local\r\n"), "deps.txt": []byte("dependency-v1")}}
	for _, dir := range []string{f.home, f.checkout} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.run("init", f.repo)
	f.run("open", f.repo, "--nested")
	f.run("setting", "mtime-changes", "off")
	global := "scip-go gomod example.org/pkg v1 alpha()."
	other := "scip-go gomod example.org/pkg v2 alpha()."
	f.index = &wire.Index{Metadata: &wire.Metadata{ProjectRoot: "file:///fixture", TextDocumentEncoding: wire.TextEncoding_UTF8, ToolInfo: &wire.ToolInfo{Name: "fixture-emitter", Version: "1"}}, Documents: []*wire.Document{
		{RelativePath: "a.go", Language: "go", Symbols: []*wire.SymbolInformation{{Symbol: global, Documentation: []string{"alpha"}, Relationships: []*wire.Relationship{{Symbol: other, IsReference: true, IsImplementation: true, IsTypeDefinition: true}}}}, Occurrences: []*wire.Occurrence{{Range: []int32{1, 5, 10}, Symbol: global, SymbolRoles: 1 | 8}, {Range: []int32{1, 5, 10}, Symbol: global, SymbolRoles: 8}, {Range: []int32{1, 5, 10}, Symbol: "local 0", SymbolRoles: 1}, {Range: []int32{0, 0, 4}, SyntaxKind: wire.SyntaxKind_Identifier}}},
		{RelativePath: "b.go", Language: "go", Occurrences: []*wire.Occurrence{{Range: []int32{0, 4, 9}, Symbol: "local 0", SymbolRoles: 1 | 4}}},
	}, ExternalSymbols: []*wire.SymbolInformation{{Symbol: other, Documentation: []string{"external"}}}}
	return f
}

func (f *graphFixture) run(args ...string) []byte {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, f.executable, args...)
	cmd.Dir = f.checkout
	cmd.Env = append(os.Environ(), "FOSSIL_HOME="+f.home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		f.t.Fatalf("fossil %v: %v\n%s", args, err, out)
	}
	return out
}
func (f *graphFixture) put(path string, data []byte) {
	f.t.Helper()
	if err := os.WriteFile(filepath.Join(f.checkout, path), data, 0600); err != nil {
		f.t.Fatal(err)
	}
}
func digestTest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func (f *graphFixture) bundle(change func(*Manifest)) []byte {
	f.t.Helper()
	for path, data := range f.sources {
		f.put(path, data)
	}
	raw, err := proto.Marshal(f.index)
	if err != nil {
		f.t.Fatal(err)
	}
	f.put("index.scip", raw)
	manifest := Manifest{Version: 1, IndexSHA256: digestTest(raw)}
	for path, data := range f.sources {
		manifest.Inputs = append(manifest.Inputs, Input{Path: path, SHA256: digestTest(data)})
	}
	if change != nil {
		change(&manifest)
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		f.t.Fatal(err)
	}
	f.put("manifest.json", data)
	return raw
}
func (f *graphFixture) provider() *fossil.Provider {
	f.t.Helper()
	p, err := fossil.New(fossil.Config{Executable: f.executable, Repository: f.repo, HeadRef: "trunk", FossilHome: f.home, Timeout: 10 * time.Second, MaxOutputBytes: 8 << 20})
	if err != nil {
		f.t.Fatal(err)
	}
	return p
}
func (f *graphFixture) commit(comment string) string {
	f.t.Helper()
	f.run("addremove")
	f.run("commit", "-m", comment, "--allow-empty", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	head, err := f.provider().Head(context.Background())
	if err != nil {
		f.t.Fatal(err)
	}
	return head.Hash
}
func openFixtureStore(t *testing.T, f *graphFixture, path string) *Store {
	t.Helper()
	s, err := Open(Config{Provider: f.provider(), MetadataPath: path, RepositoryID: "fixture", Profile: ProfileUTF8, MaxIndexBytes: 1 << 20, MaxManifestBytes: 1 << 20, MaxSourceBytes: 1 << 20, MaxFacts: 1000})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestGraphProjectionProvenanceAndStaleness(t *testing.T) {
	f := newGraphFixture(t)
	raw := f.bundle(nil)
	a := f.commit("A sv:11111111111111111111111111111111")
	dbPath := filepath.Join(t.TempDir(), "metadata.sqlite")
	store := openFixtureStore(t, f, dbPath)
	ctx := context.Background()
	defer func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	}()
	dbBefore, err := os.ReadFile(f.repo)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Import(ctx, a, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision != a || snapshot.SVRef != "11111111111111111111111111111111" || snapshot.Comment != "A sv:11111111111111111111111111111111" {
		t.Fatalf("canonical provenance %+v", snapshot)
	}
	current, err := store.Current(ctx)
	if err != nil || current.ID != snapshot.ID {
		t.Fatalf("current %+v %v", current, err)
	}
	repeat, err := store.Import(ctx, a, "index.scip", "manifest.json")
	if err != nil || repeat.ID != snapshot.ID {
		t.Fatalf("idempotence %+v %v", repeat, err)
	}
	page, err := store.Facts(ctx, snapshot.ID, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != snapshot.FactCount || page.Returned != page.Total || page.Truncated {
		t.Fatalf("facts %+v", page)
	}
	locals := map[string]bool{}
	occurrences := 0
	relationships := 0
	for _, fact := range page.Facts {
		if fact.Kind == "occurrence" {
			occurrences++
			if strings.Contains(string(fact.Payload), "local 0") {
				locals[fact.Object] = true
			}
		}
		if fact.Kind == "relationship" {
			relationships++
			if !strings.Contains(string(fact.Payload), "is_implementation") || !strings.Contains(string(fact.Payload), "is_type_definition") || !strings.Contains(string(fact.Payload), "is_reference") {
				t.Fatalf("relationship flags lost: %s", fact.Payload)
			}
		}
		if fact.Origin.IndexSHA256 != digestTest(raw) || fact.Origin.Address == "" {
			t.Fatalf("unaddressable fact %+v", fact)
		}
	}
	if occurrences != 5 || len(locals) != 2 || relationships != 1 {
		t.Fatalf("projection counts occ=%d locals=%d rel=%d", occurrences, len(locals), relationships)
	}
	limited, err := store.Facts(ctx, snapshot.ID, 1)
	if err != nil || limited.Returned != 1 || !limited.Truncated {
		t.Fatalf("limit %+v %v", limited, err)
	}
	exported, err := store.ExportSCIP(ctx, snapshot.ID)
	if err != nil || !bytes.Equal(exported, raw) {
		t.Fatalf("raw roundtrip %v", err)
	}
	receipt, err := store.Verify(ctx, snapshot.ID, a)
	if err != nil || receipt.Result != "PASS" || receipt.SemanticStatus != "unknown" || receipt.ID == "" {
		t.Fatalf("receipt %+v %v", receipt, err)
	}
	var scs bytes.Buffer
	if err := store.ExportSCs(ctx, snapshot.ID, &scs); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(scs.String(), snapshot.ID) || !strings.Contains(scs.String(), receipt.ID) || !strings.Contains(scs.String(), "engine_compatibility_unknown") {
		t.Fatalf("SCs provenance missing: %s", scs.String())
	}
	for _, fact := range page.Facts {
		if fact.Kind == "occurrence" && strings.HasPrefix(fact.Object, "global:") {
			entity := "entity_" + digestTest([]byte(fact.Object))
			if strings.Count(scs.String(), "| sc_node#"+entity+";;") < 2 || strings.Count(scs.String(), entity+"_value = [") != 1 {
				t.Fatal("SCs did not reuse the shared symbol entity")
			}
			break
		}
	}
	if strings.Count(scs.String(), "sc_common_arc#edge_") < page.Total*2 {
		t.Fatal("SCs lacks typed assertion arcs and predicates")
	}
	f.sources["deps.txt"] = []byte("dependency-v2")
	f.bundle(nil)
	b := f.commit("B")
	stale, err := store.Verify(ctx, snapshot.ID, b)
	if err != nil || stale.Result != "STALE" {
		t.Fatalf("dependency invalidation %+v %v", stale, err)
	}
	if _, err := store.Import(ctx, a, "index.scip", "manifest.json"); err == nil {
		t.Fatal("provider head mismatch accepted")
	}
	newSnapshot, err := store.Import(ctx, b, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if newSnapshot.SVRef != "" {
		t.Fatal("missing SV fabricated")
	}
	f.index.Metadata.ToolInfo.Version = "2"
	f.bundle(nil)
	stampChange := f.commit("indexer stamp changed")
	stampReceipt, err := store.Verify(ctx, newSnapshot.ID, stampChange)
	if err != nil || stampReceipt.Result != "STALE" {
		t.Fatalf("index-only applicability %+v %v", stampReceipt, err)
	}
	noop := f.commit("noop sv:22222222222222222222222222222222")
	noOpSnapshot, err := store.Import(ctx, noop, "index.scip", "manifest.json")
	if err != nil || noOpSnapshot.ID == newSnapshot.ID || noOpSnapshot.SVRef == "" {
		t.Fatalf("no-op provenance %+v %v", noOpSnapshot, err)
	}
	oldRaw, err := store.ExportSCIP(ctx, snapshot.ID)
	if err != nil || !bytes.Equal(oldRaw, raw) {
		t.Fatal("historical snapshot lost")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := store.Import(cancelled, noop, "index.scip", "manifest.json"); err == nil {
		t.Fatal("cancellation accepted")
	}
	still, err := store.Current(ctx)
	if err != nil || still.ID != noOpSnapshot.ID {
		t.Fatal("failed import changed current")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store = openFixtureStore(t, f, dbPath)
	reopened, err := store.Current(ctx)
	if err != nil || reopened.ID != noOpSnapshot.ID {
		t.Fatal("reopen lost current")
	}
	after, err := os.ReadFile(f.repo)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(dbBefore, after) {
		t.Fatal("fixture commits did not change repository")
	}
	beforeRead := append([]byte{}, after...)
	if _, err := store.Verify(ctx, snapshot.ID, b); err != nil {
		t.Fatal(err)
	}
	after, err = os.ReadFile(f.repo)
	if err != nil || !bytes.Equal(beforeRead, after) {
		t.Fatal("graph reader changed source repository")
	}
}

func TestGraphStrictRefusalsPreserveCurrent(t *testing.T) {
	cases := []struct {
		name     string
		mutate   func(*graphFixture)
		manifest func(*Manifest)
	}{
		{"utf16", func(f *graphFixture) { f.index.Metadata.TextDocumentEncoding = wire.TextEncoding_UTF16 }, nil},
		{"negative-range", func(f *graphFixture) { f.index.Documents[0].Occurrences[0].Range = []int32{-1, 0, 1} }, nil},
		{"bounds", func(f *graphFixture) { f.index.Documents[0].Occurrences[0].Range = []int32{1, 5, 999} }, nil},
		{"utf8-split", func(f *graphFixture) { f.index.Documents[0].Occurrences[0].Range = []int32{0, 1, 3} }, nil},
		{"unknown-field", func(f *graphFixture) {
			f.index.ProtoReflect().SetUnknown(protowire.AppendVarint(protowire.AppendTag(nil, 999, protowire.VarintType), 1))
		}, nil},
		{"unknown-role", func(f *graphFixture) { f.index.Documents[0].Occurrences[0].SymbolRoles = 1024 }, nil},
		{"path", func(f *graphFixture) { f.index.Documents[0].RelativePath = "../a.go" }, nil},
		{"manifest-mismatch", nil, func(m *Manifest) { m.Inputs[0].SHA256 = strings.Repeat("0", 64) }},
		{"manifest-incomplete", nil, func(m *Manifest) { m.Inputs = m.Inputs[:1] }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newGraphFixture(t)
			f.bundle(nil)
			a := f.commit("A")
			store := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
			defer store.Close()
			base, err := store.Import(context.Background(), a, "index.scip", "manifest.json")
			if err != nil {
				t.Fatal(err)
			}
			if tc.mutate != nil {
				tc.mutate(f)
			}
			f.bundle(tc.manifest)
			b := f.commit("bad")
			if _, err := store.Import(context.Background(), b, "index.scip", "manifest.json"); err == nil {
				t.Fatal("invalid import succeeded")
			}
			current, err := store.Current(context.Background())
			if err != nil || current.ID != base.ID {
				t.Fatal("refusal changed current")
			}
		})
	}
}

func TestGraphOfflineReadsAndStoredFailure(t *testing.T) {
	f := newGraphFixture(t)
	f.bundle(nil)
	revision := f.commit("canonical sv:cccccccccccccccccccccccccccccccc")
	store := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
	ctx := context.Background()
	snapshot, err := store.Import(ctx, revision, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	// A syntactically valid stored fact that disagrees with the source must
	// produce a retained runtime FAIL receipt, never a supplied PASS record.
	if _, err := store.db.Exec("UPDATE ci_graph_facts SET payload=replace(CAST(payload AS TEXT),'occurs_at','tampered') WHERE snapshot_id=?", snapshot.ID); err != nil {
		t.Fatal(err)
	}
	receipt, err := store.Verify(ctx, snapshot.ID, revision)
	if err != nil || receipt.Result != "FAIL" {
		t.Fatalf("fidelity mismatch %+v %v", receipt, err)
	}
	var count int
	if err := store.db.QueryRow("SELECT count(*) FROM ci_graph_receipts WHERE id=?", receipt.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("FAIL receipt not retained: %d %v", count, err)
	}
	config := store.config
	config.Provider = nil
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	offline, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer offline.Close()
	current, err := offline.Current(ctx)
	if err != nil || current.ID != snapshot.ID {
		t.Fatalf("offline current %+v %v", current, err)
	}
	if _, err := offline.ExportSCIP(ctx, snapshot.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := offline.Facts(ctx, snapshot.ID, 1000); err == nil {
		t.Fatal("corrupt cached fact accepted")
	}
	if _, err := offline.Import(ctx, revision, "index.scip", "manifest.json"); err == nil {
		t.Fatal("offline import accepted")
	}
	if _, err := offline.Verify(ctx, snapshot.ID, revision); err == nil {
		t.Fatal("offline verify accepted")
	}
}

func TestGraphCountAndReceiptIntegrity(t *testing.T) {
	f := newGraphFixture(t)
	f.bundle(nil)
	revision := f.commit("integrity")
	store := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
	defer store.Close()
	ctx := context.Background()
	snapshot, err := store.Import(ctx, revision, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := store.Verify(ctx, snapshot.ID, revision)
	if err != nil || receipt.Result != "PASS" {
		t.Fatalf("initial receipt %+v %v", receipt, err)
	}
	if _, err := store.db.Exec("INSERT INTO ci_graph_facts SELECT snapshot_id,'extra',ordinal+10000,payload FROM ci_graph_facts WHERE snapshot_id=? LIMIT 1", snapshot.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Facts(ctx, snapshot.ID, 1); err == nil {
		t.Fatal("extra row hidden behind bounded facts page")
	}
	failure, err := store.Verify(ctx, snapshot.ID, revision)
	if err != nil || failure.Result != "FAIL" {
		t.Fatalf("extra-row receipt %+v %v", failure, err)
	}
	if _, err := store.db.Exec("DELETE FROM ci_graph_facts WHERE fact_id='extra'"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec("UPDATE ci_graph_receipts SET receipt_json=replace(CAST(receipt_json AS TEXT),'PASS','FAIL') WHERE id=?", receipt.ID); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := store.ExportSCs(ctx, snapshot.ID, &output); err == nil || output.Len() != 0 {
		t.Fatalf("tampered receipt exported: error=%v bytes=%d", err, output.Len())
	}
}

func TestGraphMalformedWireRefused(t *testing.T) {
	for _, name := range []string{"truncated", "duplicate-metadata"} {
		t.Run(name, func(t *testing.T) {
			f := newGraphFixture(t)
			raw := f.bundle(nil)
			a := f.commit("A")
			store := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
			defer store.Close()
			base, err := store.Import(context.Background(), a, "index.scip", "manifest.json")
			if err != nil {
				t.Fatal(err)
			}
			if name == "truncated" {
				raw = raw[:len(raw)-1]
			} else {
				metadata, err := proto.Marshal(f.index.Metadata)
				if err != nil {
					t.Fatal(err)
				}
				raw = protowire.AppendBytes(protowire.AppendTag(raw, 1, protowire.BytesType), metadata)
			}
			f.put("index.scip", raw)
			manifestBytes, err := os.ReadFile(filepath.Join(f.checkout, "manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest Manifest
			if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
				t.Fatal(err)
			}
			manifest.IndexSHA256 = digestTest(raw)
			manifestBytes, err = json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			f.put("manifest.json", manifestBytes)
			bad := f.commit("bad wire")
			if _, err := store.Import(context.Background(), bad, "index.scip", "manifest.json"); err == nil {
				t.Fatal("malformed wire accepted")
			}
			current, err := store.Current(context.Background())
			if err != nil || current.ID != base.ID {
				t.Fatal("wire refusal changed current")
			}
		})
	}
}
