package mcpserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"dais.local/codeintelligence/internal/evidencegraph"
	"dais.local/codeintelligence/internal/fossil"
	wire "dais.local/codeintelligence/internal/scipwire"
	"dais.local/codeintelligence/internal/search"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/protobuf/proto"
)

type fixture struct {
	t                *testing.T
	root, repo, home string
	provider         *fossil.Provider
	graph            *evidencegraph.Store
	search           *search.Adapter
	snapshot         evidencegraph.Snapshot
}

func (f *fixture) run(args ...string) {
	f.t.Helper()
	c := exec.Command(os.Getenv("DAIS_TEST_FOSSIL"), args...)
	c.Dir = f.root
	c.Env = append(os.Environ(), "FOSSIL_HOME="+f.home)
	b, err := c.CombinedOutput()
	if err != nil {
		f.t.Fatalf("Fossil %v: %v %s", args, err, b)
	}
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func newFixture(t *testing.T) *fixture {
	t.Helper()
	dir := t.TempDir()
	f := &fixture{t: t, root: filepath.Join(dir, "checkout"), repo: filepath.Join(dir, "repo.fsl"), home: filepath.Join(dir, "home")}
	for _, name := range []string{f.root, f.home} {
		if err := os.Mkdir(name, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.run("init", f.repo)
	f.run("open", f.repo, "--nested")
	sources := map[string][]byte{"math.go": []byte("package fixture\nfunc Twice(x int) int { return x*2 }\n"), "use.go": []byte("package fixture\nfunc Use() int { return Twice(21) }\n")}
	symbol := "scip-go gomod example.org/fixture v1 Twice()."
	index := &wire.Index{Metadata: &wire.Metadata{ProjectRoot: "file:///fixture", TextDocumentEncoding: wire.TextEncoding_UTF8, ToolInfo: &wire.ToolInfo{Name: "fixture", Version: "1"}}, Documents: []*wire.Document{{RelativePath: "math.go", Occurrences: []*wire.Occurrence{{Range: []int32{1, 5, 10}, Symbol: symbol, SymbolRoles: 1}}}, {RelativePath: "use.go", Occurrences: []*wire.Occurrence{{Range: []int32{1, 24, 29}, Symbol: symbol}}}}}
	raw, err := proto.Marshal(index)
	if err != nil {
		t.Fatal(err)
	}
	manifest := evidencegraph.Manifest{Version: 1, IndexSHA256: digest(raw)}
	for name, data := range sources {
		if err := os.WriteFile(filepath.Join(f.root, name), data, 0600); err != nil {
			t.Fatal(err)
		}
		manifest.Inputs = append(manifest.Inputs, evidencegraph.Input{Path: name, SHA256: digest(data)})
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{"index.scip": raw, "manifest.json": encoded} {
		if err := os.WriteFile(filepath.Join(f.root, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	f.run("addremove")
	f.run("commit", "--hash", "-m", "MCP sv:abababababababababababababababab", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	f.provider, err = fossil.New(fossil.Config{Executable: os.Getenv("DAIS_TEST_FOSSIL"), Repository: f.repo, FossilHome: f.home, HeadRef: "trunk", Timeout: 10 * time.Second, MaxOutputBytes: 4 << 20})
	if err != nil {
		t.Fatal(err)
	}
	head, err := f.provider.Head(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	indexRoot := filepath.Join(dir, "index")
	f.search, err = search.New(search.Config{IndexRoot: indexRoot, RepositoryID: "fixture", Provider: f.provider, Exclude: []string{"index.scip", "manifest.json"}, MaxResults: 100, MaxResponseBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.search.Index(context.Background(), head, "full"); err != nil {
		t.Fatal(err)
	}
	f.graph, err = evidencegraph.Open(evidencegraph.Config{Provider: f.provider, MetadataPath: filepath.Join(indexRoot, "metadata.sqlite"), RepositoryID: "fixture", Profile: evidencegraph.ProfileUTF8, MaxFacts: 1000, MaxIndexBytes: 1 << 20, MaxManifestBytes: 1 << 20, MaxSourceBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	f.snapshot, err = f.graph.Import(context.Background(), head.Hash, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := f.graph.Close(); err != nil {
			t.Error(err)
		}
		if err := f.search.Close(); err != nil {
			t.Error(err)
		}
		deadline := time.Now().Add(3 * time.Second)
		for {
			runtime.GC()
			if err := os.RemoveAll(indexRoot); err == nil {
				break
			} else if time.Now().After(deadline) {
				t.Error("mapped fixture index cleanup", err)
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
	})
	return f
}
func (f *fixture) config() Config {
	return Config{Graph: f.graph, Search: f.search, SnapshotID: f.snapshot.ID, TargetRevision: f.snapshot.Revision, MaxResults: 10, MaxResponseBytes: 1 << 20, MaxFrameBytes: 1 << 20, RequestTimeout: 5 * time.Second, Diagnostics: io.Discard}
}
func connect(t *testing.T, server *Server) (*mcp.ClientSession, <-chan error) {
	t.Helper()
	a, b := mcp.NewInMemoryTransports()
	done := make(chan error, 1)
	go func() { done <- server.Run(context.Background(), a) }()
	client := mcp.NewClient(&mcp.Implementation{Name: "fixture-client", Version: "1"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, b, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := session.Close(); err != nil {
			t.Error(err)
		}
	})
	return session, done
}
func call(t *testing.T, session *mcp.ClientSession, name string, args any) *mcp.CallToolResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func decodeResult(t *testing.T, result *mcp.CallToolResult, value any) {
	t.Helper()
	if result.IsError {
		content, err := json.Marshal(result.Content)
		if err != nil {
			t.Fatalf("tool error content encoding: %v", err)
		}
		t.Fatalf("unexpected tool error content=%s", content)
	}
	b, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, value); err != nil {
		t.Fatal(err)
	}
}

func TestSDKInMemoryToolsEvidenceAndEOF(t *testing.T) {
	f := newFixture(t)
	server, err := New(context.Background(), f.config())
	if err != nil {
		t.Fatal(err)
	}
	session, done := connect(t, server)
	list, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, tool := range list.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	if strings.Join(names, ",") != "codesearch,indexstatus,referenceimpact,symboldefinition,symbolreferences" {
		t.Fatalf("tools %v", names)
	}
	var definition NavigationResponse
	decodeResult(t, call(t, session, "symboldefinition", map[string]any{"document_path": "use.go", "line": 1, "character": 24, "limit": 10}), &definition)
	if definition.Navigation.Total != 1 || definition.Navigation.Locations[0].Origin.DocumentPath != "math.go" || definition.Verification.Result != "PASS" || len(definition.Verification.InstrumentSHA256) != 64 || definition.Navigation.Snapshot.SVRef != "abababababababababababababababab" {
		t.Fatalf("definition/evidence %+v", definition)
	}
	var references NavigationResponse
	decodeResult(t, call(t, session, "symbolreferences", map[string]any{"document_path": "math.go", "line": 1, "character": 5, "limit": 10}), &references)
	if references.Navigation.Total != 1 || references.Navigation.Locations[0].Origin.DocumentPath != "use.go" {
		t.Fatalf("references %+v", references)
	}
	var text SearchResponse
	decodeResult(t, call(t, session, "codesearch", map[string]any{"kind": "code", "query": "Twice", "limit": 10}), &text)
	if text.Returned != 2 || !text.Complete || text.Truncated || text.SearchSnapshot.Revision != f.snapshot.Revision || text.Verification.Result != "PASS" {
		t.Fatalf("text %+v", text)
	}
	for _, location := range text.Results {
		if location.ArtifactHash == "" || location.Revision != f.snapshot.Revision || location.Generation != text.SearchSnapshot.Generation {
			t.Fatalf("search provenance %+v", location)
		}
	}
	decodeResult(t, call(t, session, "codesearch", map[string]any{"kind": "code", "query": "Twice", "limit": 1}), &text)
	if text.Returned != 1 || !text.Truncated {
		t.Fatalf("limit %+v", text)
	}
	var status StatusResponse
	decodeResult(t, call(t, session, "indexstatus", map[string]any{}), &status)
	if status.Verification.Result != "PASS" || status.Snapshot.ID != f.snapshot.ID || status.SemanticStatus != "unknown" {
		t.Fatalf("status %+v", status)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("EOF did not terminate server")
	}
}

func TestSDKArgumentAndStartupRefusals(t *testing.T) {
	f := newFixture(t)
	server, err := New(context.Background(), f.config())
	if err != nil {
		t.Fatal(err)
	}
	session, done := connect(t, server)
	defer func() {
		if err := session.Close(); err != nil {
			t.Error(err)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("server did not stop")
		}
	}()
	for _, tc := range []struct {
		name string
		args any
	}{{"symboldefinition", map[string]any{"document_path": "use.go", "line": 1, "character": 24}}, {"symboldefinition", map[string]any{"document_path": "use.go", "line": 1, "character": 24, "limit": 1, "repository": "other"}}, {"symboldefinition", map[string]any{"document_path": "../use.go", "line": 1, "character": 24, "limit": 1}}, {"symboldefinition", map[string]any{"document_path": "use.go", "line": 1, "character": 24, "limit": 0}}, {"symboldefinition", map[string]any{"document_path": "use.go", "line": 1, "character": 24, "limit": 11}}, {"codesearch", map[string]any{"kind": "bad", "query": "Twice", "limit": 1}}, {"indexstatus", map[string]any{"snapshot": "other"}}} {
		if r := call(t, session, tc.name, tc.args); !r.IsError {
			t.Fatalf("invalid args accepted %s %+v", tc.name, tc.args)
		}
	}
	if _, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "callers", Arguments: map[string]any{}}); err == nil {
		t.Fatal("unknown tool was not a protocol error")
	}
	var empty NavigationResponse
	decodeResult(t, call(t, session, "symboldefinition", map[string]any{"document_path": "missing.go", "line": 0, "character": 0, "limit": 1}), &empty)
	if empty.Navigation.Total != 0 {
		t.Fatal("fabricated missing symbol")
	}
	for _, mode := range []string{"snapshot", "target", "limit", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			cfg := f.config()
			switch mode {
			case "snapshot":
				cfg.SnapshotID = strings.Repeat("0", 64)
			case "target":
				cfg.TargetRevision = strings.Repeat("1", 64)
			case "limit":
				cfg.MaxResults = 0
			case "timeout":
				cfg.RequestTimeout = 0
			}
			if _, err := New(context.Background(), cfg); err == nil {
				t.Fatal("invalid startup accepted")
			}
		})
	}
	// An actual new publication, even with the same immutable target bytes,
	// invalidates the fixed generation rather than silently following it.
	head, err := f.provider.Revision(context.Background(), f.snapshot.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.search.Index(context.Background(), head, "full"); err != nil {
		t.Fatal(err)
	}
	if r := call(t, session, "codesearch", map[string]any{"kind": "code", "query": "Twice", "limit": 1}); !r.IsError {
		t.Fatal("changed generation silently followed")
	}
}

type writeCloser struct{ io.Writer }

func (writeCloser) Close() error { return nil }
func TestSDKFrameBoundAndCancellation(t *testing.T) {
	f := newFixture(t)
	cfg := f.config()
	server, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := server.Run(context.Background(), &mcp.IOTransport{Reader: io.NopCloser(strings.NewReader(strings.Repeat(" ", cfg.MaxFrameBytes+10) + "\n")), Writer: writeCloser{&output}, MaxLineLength: cfg.MaxFrameBytes}); err == nil {
		t.Fatal("oversize input frame accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := New(ctx, cfg); err == nil {
		t.Fatal("cancelled preflight accepted")
	}
	a, _ := mcp.NewInMemoryTransports()
	runCtx, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.Run(runCtx, a) }()
	stop()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel returned success")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("context cancellation did not stop server")
	}
}

func TestSDKHistoricalPinAndActualStaleStartup(t *testing.T) {
	f := newFixture(t)
	original := f.snapshot
	f.run("commit", "--hash", "-m", "historical no-op", "--allow-empty", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	head, err := f.provider.Head(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	newer, err := f.graph.Import(context.Background(), head.Hash, "index.scip", "manifest.json")
	if err != nil || newer.ID == original.ID {
		t.Fatalf("no-op fixture did not advance graph %+v %v", newer, err)
	}
	server, err := New(context.Background(), f.config())
	if err != nil {
		t.Fatal("explicit historical snapshot unexpectedly required current", err)
	}
	session, done := connect(t, server)
	var status StatusResponse
	decodeResult(t, call(t, session, "indexstatus", map[string]any{}), &status)
	if status.Snapshot.ID != original.ID || status.Verification.TargetRevision != original.Revision {
		t.Fatalf("historical pin followed current %+v", status)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("historical session did not stop")
	}
	if err := os.WriteFile(filepath.Join(f.root, "math.go"), []byte("package fixture\nfunc Twice(x int) int { return x*3 }\n"), 0600); err != nil {
		t.Fatal(err)
	}
	f.run("commit", "--hash", "-m", "actual changed source", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	changed, err := f.provider.Head(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.search.Index(context.Background(), changed, "delta"); err != nil {
		t.Fatal(err)
	}
	cfg := f.config()
	cfg.TargetRevision = changed.Hash
	if _, err := New(context.Background(), cfg); err == nil || !strings.Contains(err.Error(), "STALE") {
		t.Fatalf("actual stale source accepted %v", err)
	}
}

func TestSDKResponseBytesAndPerToolDeadline(t *testing.T) {
	f := newFixture(t)
	cfg := f.config()
	cfg.MaxResponseBytes = 1024
	server, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	session, done := connect(t, server)
	if result := call(t, session, "indexstatus", map[string]any{}); !result.IsError {
		t.Fatal("oversize result silently emitted")
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("bounded session did not stop")
	}
	server, err = New(context.Background(), f.config())
	if err != nil {
		t.Fatal(err)
	}
	server.config.RequestTimeout = time.Nanosecond
	session, done = connect(t, server)
	if result := call(t, session, "indexstatus", map[string]any{}); !result.IsError {
		t.Fatal("expired tool deadline returned success")
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("deadline session did not stop")
	}
}

func TestSDKCachedCorruptionIsVerifiedAgain(t *testing.T) {
	f := newFixture(t)
	server, err := New(context.Background(), f.config())
	if err != nil {
		t.Fatal(err)
	}
	session, done := connect(t, server)
	db, err := sql.Open("sqlite", filepath.Join(filepath.Dir(f.root), "index", "metadata.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE ci_graph_facts SET payload=replace(CAST(payload AS TEXT),'occurs_at','tampered') WHERE snapshot_id=?", f.snapshot.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	result := call(t, session, "symboldefinition", map[string]any{"document_path": "use.go", "line": 1, "character": 24, "limit": 1})
	if !result.IsError {
		t.Fatal("cached corruption returned navigation")
	}
	encoded, err := json.Marshal(result.Content)
	if err != nil || !bytes.Contains(encoded, []byte("FAIL")) {
		t.Fatalf("corruption failed for unrelated reason %s %v", encoded, err)
	}
	if _, err := New(context.Background(), f.config()); err == nil || !strings.Contains(err.Error(), "FAIL") {
		t.Fatalf("corrupted startup accepted %v", err)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("corrupt session did not stop")
	}
}

func TestSDKReferenceImpactPinnedScope(t *testing.T) {
	f := newFixture(t)
	before := f.snapshot
	source := []byte("package fixture\nfunc Twice(x int) int { return x*3 }\n")
	if err := os.WriteFile(filepath.Join(f.root, "math.go"), source, 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(f.root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest evidencegraph.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for i := range manifest.Inputs {
		if manifest.Inputs[i].Path == "math.go" {
			manifest.Inputs[i].SHA256 = digest(source)
		}
	}
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.root, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	f.run("commit", "--hash", "-m", "changed Twice body sv:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	head, err := f.provider.Head(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	f.snapshot, err = f.graph.Import(context.Background(), head.Hash, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.search.Index(context.Background(), head, "full"); err != nil {
		t.Fatal(err)
	}
	server, err := New(context.Background(), f.config())
	if err != nil {
		t.Fatal(err)
	}
	session, done := connect(t, server)
	defer func() {
		if err := session.Close(); err != nil {
			t.Error(err)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("reference impact session did not stop")
		}
	}()
	args := map[string]any{"before_snapshot": before.ID, "before_target_revision": before.Revision, "limit": 10}
	var response struct {
		Impact struct {
			SemanticStatus string `json:"semantic_status"`
			Before         struct {
				Snapshot     evidencegraph.Snapshot `json:"snapshot"`
				Verification evidencegraph.Receipt  `json:"verification"`
				Coverage     struct {
					MatchingReferences int `json:"matching_references"`
				} `json:"coverage"`
			} `json:"before"`
			After struct {
				Snapshot     evidencegraph.Snapshot `json:"snapshot"`
				Verification evidencegraph.Receipt  `json:"verification"`
				Coverage     struct {
					MatchingReferences int `json:"matching_references"`
				} `json:"coverage"`
			} `json:"after"`
			Witnesses []struct {
				Side        string               `json:"side"`
				Reference   evidencegraph.Fact   `json:"reference"`
				Definitions []evidencegraph.Fact `json:"definitions"`
			} `json:"witnesses"`
			AffectedFiles []string `json:"affected_files"`
			Total         int      `json:"total"`
			Returned      int      `json:"returned"`
			Truncated     bool     `json:"truncated"`
			Complete      bool     `json:"complete"`
		} `json:"impact"`
		Verification   evidencegraph.Receipt `json:"verification"`
		SearchSnapshot SearchSnapshot        `json:"search_snapshot"`
	}
	decodeResult(t, call(t, session, "referenceimpact", args), &response)
	if response.Impact.Total != 2 || response.Impact.Returned != 2 || len(response.Impact.Witnesses) != 2 || !response.Impact.Complete || response.Impact.Truncated || response.Impact.SemanticStatus != "unknown" || strings.Join(response.Impact.AffectedFiles, ",") != "use.go" {
		t.Fatalf("reference witnesses %+v", response)
	}
	if response.Impact.Before.Snapshot.ID != before.ID || response.Impact.After.Snapshot.ID != f.snapshot.ID || response.Verification.TargetRevision != head.Hash || response.SearchSnapshot.Revision != head.Hash || response.Verification.Result != "PASS" || len(response.Verification.InstrumentSHA256) != 64 || response.Impact.Before.Verification.Result != "PASS" || response.Impact.After.Verification.ID != response.Verification.ID {
		t.Fatalf("fixed scope and actual receipts %+v", response)
	}
	for i, witness := range response.Impact.Witnesses {
		if witness.Side != []string{"before", "after"}[i] || witness.Reference.Origin.DocumentPath != "use.go" || len(witness.Definitions) != 1 || witness.Definitions[0].Origin.DocumentPath != "math.go" {
			t.Fatalf("witness %d %+v", i, witness)
		}
	}
	args["limit"] = 1
	decodeResult(t, call(t, session, "referenceimpact", args), &response)
	if response.Impact.Total != 2 || response.Impact.Returned != 1 || len(response.Impact.Witnesses) != 1 || !response.Impact.Truncated || response.Impact.Complete || response.Impact.Before.Coverage.MatchingReferences != 1 || response.Impact.After.Coverage.MatchingReferences != 1 {
		t.Fatalf("bounded impact %+v", response)
	}
	maximum := server.config.MaxResponseBytes
	server.config.MaxResponseBytes = 1024
	bounded := call(t, session, "referenceimpact", args)
	server.config.MaxResponseBytes = maximum
	boundedContent, err := json.Marshal(bounded.Content)
	if err != nil || !bounded.IsError || !bytes.Contains(boundedContent, []byte("bound")) {
		t.Fatalf("oversize reference impact did not fail its byte bound %s %v", boundedContent, err)
	}
	for _, bad := range []map[string]any{
		{"before_snapshot": before.ID, "limit": 1},
		{"before_snapshot": "bad", "before_target_revision": before.Revision, "limit": 1},
		{"before_snapshot": before.ID, "before_target_revision": "trunk", "limit": 1},
		{"before_snapshot": before.ID, "before_target_revision": before.Revision, "limit": 0},
		{"before_snapshot": before.ID, "before_target_revision": before.Revision, "limit": 11},
		{"before_snapshot": before.ID, "before_target_revision": before.Revision, "limit": 1, "after_snapshot": before.ID},
		{"before_snapshot": strings.Repeat("0", 64), "before_target_revision": before.Revision, "limit": 1},
		{"before_snapshot": before.ID, "before_target_revision": head.Hash, "limit": 1},
	} {
		if result := call(t, session, "referenceimpact", bad); !result.IsError {
			t.Fatalf("invalid impact accepted %+v", bad)
		}
	}
	db, err := sql.Open("sqlite", filepath.Join(filepath.Dir(f.root), "index", "metadata.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE ci_graph_facts SET payload=replace(CAST(payload AS TEXT),'occurs_at','tampered') WHERE snapshot_id=?", before.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	result := call(t, session, "referenceimpact", args)
	encoded, err := json.Marshal(result.Content)
	if err != nil || !result.IsError || !bytes.Contains(encoded, []byte("FAIL")) {
		t.Fatalf("corrupt before snapshot did not fail verification %s %v", encoded, err)
	}
	if _, err := f.search.Index(context.Background(), head, "full"); err != nil {
		t.Fatal(err)
	}
	result = call(t, session, "referenceimpact", args)
	encoded, err = json.Marshal(result.Content)
	if err != nil || !result.IsError || !bytes.Contains(encoded, []byte("generation changed")) {
		t.Fatalf("changed generation was silently followed %s %v", encoded, err)
	}
}
