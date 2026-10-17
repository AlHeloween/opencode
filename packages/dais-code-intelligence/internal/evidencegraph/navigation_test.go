package evidencegraph

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	wire "dais.local/codeintelligence/internal/scipwire"
)

func navigationFixture(t *testing.T) (*Store, Snapshot, *graphFixture) {
	t.Helper()
	f := newGraphFixture(t)
	global := "scip-go gomod example.org/pkg v1 alpha()."
	external := "scip-go gomod example.org/pkg v2 alpha()."
	multi := "scip-go gomod example.org/pkg v1 multi()."
	f.index.Documents[0].Occurrences = append(f.index.Documents[0].Occurrences,
		&wire.Occurrence{Range: []int32{1, 5, 10}, Symbol: global},
		&wire.Occurrence{Range: []int32{0, 5, 1, 4}, Symbol: multi, SymbolRoles: 8},
		&wire.Occurrence{Range: []int32{0, 0, 4}, Symbol: external})
	f.index.Documents[1].Occurrences = append(f.index.Documents[1].Occurrences,
		&wire.Occurrence{Range: []int32{0, 4, 9}, Symbol: "local 0"},
		&wire.Occurrence{Range: []int32{0, 0, 3}, Symbol: multi, SymbolRoles: 1})
	f.bundle(nil)
	revision := f.commit("navigation sv:abababababababababababababababab")
	store := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	snapshot, err := store.Import(context.Background(), revision, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	return store, snapshot, f
}

func TestNavigateAmbiguityDuplicatesLocalScopeAndLimit(t *testing.T) {
	s, snapshot, f := navigationFixture(t)
	before, err := os.ReadFile(f.repo)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	point := Position{DocumentPath: "a.go", Line: 1, Character: 5}
	defs, err := s.Navigate(ctx, snapshot.ID, point, Definitions, 100)
	if err != nil {
		t.Fatal(err)
	}
	if defs.Snapshot != snapshot || len(defs.Symbols) != 2 || defs.Total != 2 || defs.Returned != 2 || defs.Truncated || defs.SemanticStatus != "unknown" || !sort.StringsAreSorted(defs.Symbols) {
		t.Fatalf("ambiguous definition result %+v", defs)
	}
	if defs.Locations[0].Origin.Address != "documents[0].occurrences[0]" || defs.Locations[1].Origin.Address != "documents[0].occurrences[2]" {
		t.Fatalf("definition order/origins %+v", defs.Locations)
	}
	refs, err := s.Navigate(ctx, snapshot.ID, point, References, 100)
	if err != nil {
		t.Fatal(err)
	}
	if refs.Total != 2 || len(refs.Locations) != 2 || refs.Locations[0].ID == refs.Locations[1].ID {
		t.Fatalf("duplicate references lost %+v", refs)
	}
	for _, fact := range refs.Locations {
		if fact.Origin.DocumentPath != "a.go" {
			t.Fatal("cross-document local symbol leaked")
		}
	}
	limited, err := s.Navigate(ctx, snapshot.ID, point, Definitions, 1)
	if err != nil {
		t.Fatal(err)
	}
	if limited.Total != 2 || limited.Returned != 1 || !limited.Truncated || !reflect.DeepEqual(limited.Symbols, defs.Symbols) || limited.Locations[0].ID != defs.Locations[0].ID {
		t.Fatalf("output limit applied before matching %+v", limited)
	}
	local, err := s.Navigate(ctx, snapshot.ID, Position{DocumentPath: "b.go", Line: 0, Character: 4}, References, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(local.Symbols) != 1 || local.Total != 1 || local.Locations[0].Origin.DocumentPath != "b.go" {
		t.Fatalf("local scope %+v", local)
	}
	for _, key := range defs.Symbols {
		if local.Symbols[0] == key {
			t.Fatal("local identities collapsed across documents")
		}
	}
	page, err := s.Facts(ctx, snapshot.ID, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, location := range append(defs.Locations, refs.Locations...) {
		found := false
		for _, fact := range page.Facts {
			if location.ID == fact.ID {
				found = true
				if !reflect.DeepEqual(location, fact) {
					t.Fatal("location payload/origin changed")
				}
			}
		}
		if !found {
			t.Fatal("location fabricated")
		}
	}
	after, err := os.ReadFile(f.repo)
	if err != nil || digestTest(before) != digestTest(after) {
		t.Fatal("navigation changed Fossil")
	}
}

func TestNavigateRangeEndpointsAndUnresolvedSymbols(t *testing.T) {
	s, snapshot, _ := navigationFixture(t)
	for _, tc := range []struct {
		name, path                      string
		line, character, total, symbols int
	}{{"multiline-start", "a.go", 0, 5, 1, 1}, {"multiline-interior", "a.go", 1, 0, 1, 1}, {"multiline-end-exclusive", "a.go", 1, 4, 0, 0}, {"singleline-end-exclusive", "a.go", 1, 10, 0, 0}, {"external-not-definition", "a.go", 0, 0, 0, 1}, {"symbol-less-only", "a.go", 0, 4, 0, 0}, {"unindexed-document", "missing.go", 0, 0, 0, 0}, {"outside-indexed-ranges", "a.go", 999, 999, 0, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := s.Navigate(context.Background(), snapshot.ID, Position{DocumentPath: tc.path, Line: tc.line, Character: tc.character}, Definitions, 100)
			if err != nil {
				t.Fatal(err)
			}
			if got.Total != tc.total || len(got.Symbols) != tc.symbols || got.Returned != tc.total || got.Truncated || got.Locations == nil || got.Symbols == nil {
				t.Fatalf("endpoint/unresolved %+v", got)
			}
			if tc.name == "multiline-start" || tc.name == "multiline-interior" {
				if got.Locations[0].Origin.DocumentPath != "b.go" || got.Locations[0].Origin.Address != "documents[1].occurrences[2]" {
					t.Fatal("multiline resolved wrong symbol")
				}
			}
		})
	}
}

func TestNavigateRefusalsAndCorruption(t *testing.T) {
	s, snapshot, _ := navigationFixture(t)
	ctx := context.Background()
	point := Position{DocumentPath: "a.go", Line: 1, Character: 6}
	for _, tc := range []struct {
		name     string
		position Position
		mode     NavigationMode
		limit    int
		id       string
	}{{"zero-limit", point, Definitions, 0, snapshot.ID}, {"negative-limit", point, Definitions, -1, snapshot.ID}, {"oversize-limit", point, Definitions, 1001, snapshot.ID}, {"unsupported-mode", point, NavigationMode("callers"), 1, snapshot.ID}, {"negative-line", Position{DocumentPath: "a.go", Line: -1}, Definitions, 1, snapshot.ID}, {"negative-character", Position{DocumentPath: "a.go", Character: -1}, Definitions, 1, snapshot.ID}, {"unsafe-path", Position{DocumentPath: "../a.go"}, Definitions, 1, snapshot.ID}, {"empty-path", Position{}, Definitions, 1, snapshot.ID}, {"missing-snapshot", point, Definitions, 1, strings.Repeat("0", 64)}} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.Navigate(ctx, tc.id, tc.position, tc.mode, tc.limit); err == nil {
				t.Fatal("invalid navigation accepted")
			}
		})
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := s.Navigate(cancelled, snapshot.ID, point, Definitions, 1); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	maximum := s.config.MaxFacts
	s.config.MaxFacts = 1
	if _, err := s.Navigate(ctx, snapshot.ID, point, Definitions, 1); err == nil {
		t.Fatal("truncated input silently scanned")
	}
	s.config.MaxFacts = maximum
	if _, err := s.db.Exec("UPDATE ci_graph_facts SET payload=replace(CAST(payload AS TEXT),'occurs_at','tampered') WHERE snapshot_id=?", snapshot.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Navigate(ctx, snapshot.ID, point, Definitions, 1); err == nil {
		t.Fatal("corrupt cached occurrence accepted")
	}
}

func TestNavigateModernNativeProducerBytePositions(t *testing.T) {
	f := newGraphFixture(t)
	f.sources = map[string][]byte{}
	for _, name := range []string{"go.mod", "math.go", "use.go"} {
		data, err := os.ReadFile(filepath.Join("testdata", "modern", name))
		if err != nil {
			t.Fatal(err)
		}
		f.sources[name] = data
	}
	raw, err := os.ReadFile(filepath.Join("testdata", "modern", "native.scip"))
	if err != nil {
		t.Fatal(err)
	}
	modernBundle(t, f, raw)
	revision := f.commit("navigation modern")
	s, err := Open(Config{Provider: f.provider(), MetadataPath: filepath.Join(t.TempDir(), "metadata.sqlite"), RepositoryID: "modern-navigation", Profile: ProfileModernUTF8, MaxIndexBytes: 1 << 20, MaxManifestBytes: 1 << 20, MaxSourceBytes: 1 << 20, MaxFacts: 1000})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	snapshot, err := s.Import(context.Background(), revision, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	line := strings.Split(string(f.sources["use.go"]), "\n")[2]
	column := strings.Index(line, "Twice")
	if column < 0 {
		t.Fatal("independent source fixture has no Twice")
	}
	defs, err := s.Navigate(context.Background(), snapshot.ID, Position{DocumentPath: "use.go", Line: 2, Character: column}, Definitions, 10)
	if err != nil {
		t.Fatal(err)
	}
	if defs.Total != 1 || defs.Locations[0].Origin.DocumentPath != "math.go" {
		t.Fatalf("modern definition %+v", defs)
	}
	var payload struct {
		Range []int32 `json:"range"`
	}
	if err := json.Unmarshal(defs.Locations[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(payload.Range, []int32{3, 5, 10}) {
		t.Fatalf("modern definition range %v", payload.Range)
	}
	refs, err := s.Navigate(context.Background(), snapshot.ID, Position{DocumentPath: "math.go", Line: 3, Character: 5}, References, 10)
	if err != nil {
		t.Fatal(err)
	}
	if refs.Total != 1 || refs.Locations[0].Origin.DocumentPath != "use.go" {
		t.Fatalf("modern references %+v", refs)
	}
	if err := json.Unmarshal(refs.Locations[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(payload.Range, []int32{2, int32(column), int32(column + 5)}) {
		t.Fatalf("UTF8 byte reference range %v expected bytecolumn%d", payload.Range, column)
	}
}
