package evidencegraph

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	wire "dais.local/codeintelligence/internal/scipwire"
)

func impactFixture(t *testing.T) (*Store, Snapshot, Snapshot, *graphFixture) {
	t.Helper()
	f := newGraphFixture(t)
	global := "scip-go gomod example.org/pkg v1 alpha()."
	other := "scip-go gomod example.org/pkg v2 alpha()."
	f.index.Documents[0].Occurrences = append(f.index.Documents[0].Occurrences, &wire.Occurrence{Range: []int32{1, 5, 10}, Symbol: global, SymbolRoles: 1})
	f.index.Documents[1].Occurrences = append(f.index.Documents[1].Occurrences,
		&wire.Occurrence{Range: []int32{0, 4, 9}, Symbol: global},
		&wire.Occurrence{Range: []int32{0, 4, 9}, Symbol: global},
		&wire.Occurrence{Range: []int32{0, 4, 9}, Symbol: other},
		&wire.Occurrence{Range: []int32{0, 4, 9}, Symbol: "local 0"})
	f.bundle(nil)
	a := f.commit("impact A sv:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	s := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	before, err := s.Import(context.Background(), a, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	f.sources["a.go"] = append(f.sources["a.go"], []byte("// changed\n")...)
	f.bundle(nil)
	b := f.commit("impact B sv:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	after, err := s.Import(context.Background(), b, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	return s, before, after, f
}

func impactRequest(before, after Snapshot, limit int) ImpactRequest {
	return ImpactRequest{BeforeSnapshotID: before.ID, BeforeTargetRevision: before.Revision, AfterSnapshotID: after.ID, AfterTargetRevision: after.Revision, Limit: limit}
}

func TestReferenceImpactWitnessesCoverageAndLimits(t *testing.T) {
	s, before, after, f := impactFixture(t)
	repoBefore, err := os.ReadFile(f.repo)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 100))
	if err != nil {
		t.Fatal(err)
	}
	if got.Profile != "direct_scip_references_v1" || got.SemanticStatus != "unknown" || got.Total != 4 || got.Returned != 4 || got.Truncated || !got.Complete || !reflect.DeepEqual(got.AffectedFiles, []string{"b.go"}) {
		t.Fatalf("result %+v", got)
	}
	if got.Before.TargetSVRef != strings.Repeat("a", 32) || got.After.TargetSVRef != strings.Repeat("b", 32) || got.Before.Verification.Result != "PASS" || got.After.Verification.Result != "PASS" {
		t.Fatalf("provenance %+v", got)
	}
	for i, witness := range got.Witnesses {
		wantSide := "before"
		if i >= 2 {
			wantSide = "after"
		}
		if witness.Side != wantSide || witness.Reference.Origin.DocumentPath != "b.go" || len(witness.Definitions) != 2 || witness.Definitions[0].Origin.DocumentPath != "a.go" {
			t.Fatalf("witness %+v", witness)
		}
		if !strings.Contains(string(witness.Reference.Payload), "alpha") {
			t.Fatal("reference changed")
		}
	}
	if got.Witnesses[0].Reference.ID == got.Witnesses[1].Reference.ID {
		t.Fatal("duplicate ordinals collapsed")
	}
	if got.Before.Coverage.ChangedDefinitions != 3 || !reflect.DeepEqual(got.Before.Coverage.IndexedPaths, []string{"a.go"}) || !reflect.DeepEqual(got.Before.Coverage.UnindexedPaths, []string{"manifest.json"}) {
		t.Fatalf("coverage %+v", got.Before.Coverage)
	}
	if got.Before.Coverage.UnresolvedReferences != 1 || got.Before.Coverage.UnboundReferences != 1 {
		t.Fatalf("unresolved %+v", got.Before.Coverage)
	}
	limited, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 1))
	if err != nil || limited.Total != 4 || limited.Returned != 1 || !limited.Truncated || limited.Complete || !reflect.DeepEqual(limited.AffectedFiles, got.AffectedFiles) {
		t.Fatalf("limit %+v %v", limited, err)
	}
	if limited.Before.Coverage.MatchingReferences != 2 || limited.After.Coverage.MatchingReferences != 2 {
		t.Fatalf("matching counts applied after limit %+v", limited)
	}
	reverse, err := s.ReferenceImpact(context.Background(), impactRequest(after, before, 100))
	if err != nil || reverse.Total != got.Total || reverse.Before.TargetRevision.Hash != after.Revision {
		t.Fatalf("reverse %+v %v", reverse, err)
	}
	noop, err := s.ReferenceImpact(context.Background(), impactRequest(after, after, 100))
	if err != nil || noop.Total != 0 || len(noop.Changes) != 0 || !noop.Complete || noop.Witnesses == nil || noop.AffectedFiles == nil {
		t.Fatalf("noop %+v %v", noop, err)
	}
	encoded, err := json.Marshal(got)
	if err != nil || !strings.Contains(string(encoded), `"target_sv_ref"`) || strings.Contains(string(encoded), `"Before"`) {
		t.Fatalf("JSON %s %v", encoded, err)
	}
	repoAfter, err := os.ReadFile(f.repo)
	if err != nil || !reflect.DeepEqual(repoBefore, repoAfter) {
		t.Fatal("impact changed Fossil")
	}
}

func TestValidateReferenceImpactSize(t *testing.T) {
	s, before, after, _ := impactFixture(t)
	value, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 100))
	if err != nil {
		t.Fatal(err)
	}
	for _, count := range []int{0, 1, 4} {
		candidate := value
		candidate.Witnesses = value.Witnesses[:count]
		encoded, err := json.Marshal(candidate)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateReferenceImpactSize(candidate, len(encoded)+1); err != nil {
			t.Fatalf("exact newline bound %d: %v", count, err)
		}
		if err := ValidateReferenceImpactSize(candidate, len(encoded)); err == nil {
			t.Fatalf("missing newline budget %d", count)
		}
	}
	if err := ValidateReferenceImpactSize(value, 0); err == nil {
		t.Fatal("zero bound accepted")
	}
	large := value
	large.Witnesses = append([]ImpactWitness{}, value.Witnesses...)
	large.Witnesses[0].Definitions = make([]Fact, 5000)
	for i := range large.Witnesses[0].Definitions {
		large.Witnesses[0].Definitions[i] = value.Witnesses[0].Definitions[i%2]
	}
	if err := ValidateReferenceImpactSize(large, 100000); err == nil {
		t.Fatal("high fanout exceeded byte bound")
	}
	alias := value
	alias.Witnesses = append([]ImpactWitness{}, value.Witnesses...)
	alias.Witnesses[1].Reference = alias.Witnesses[0].Reference
	alias.Witnesses[1].Reference.Predicate = "different payload under reused fact ID"
	if err := ValidateReferenceImpactSize(alias, 100000); err == nil {
		t.Fatal("fact identity alias accepted by size cache")
	}
}

func TestReferenceImpactRefusals(t *testing.T) {
	s, before, after, f := impactFixture(t)
	for _, tc := range []struct {
		name   string
		change func(*ImpactRequest)
	}{
		{"zero", func(r *ImpactRequest) { r.Limit = 0 }}, {"too-many", func(r *ImpactRequest) { r.Limit = 1001 }},
		{"short-before-target", func(r *ImpactRequest) { r.BeforeTargetRevision = "trunk" }}, {"short-after-target", func(r *ImpactRequest) { r.AfterTargetRevision = "trunk" }},
		{"missing-before", func(r *ImpactRequest) { r.BeforeSnapshotID = strings.Repeat("0", 64) }}, {"missing-after", func(r *ImpactRequest) { r.AfterSnapshotID = strings.Repeat("0", 64) }},
		{"stale-before", func(r *ImpactRequest) { r.BeforeTargetRevision = after.Revision }}, {"stale-after", func(r *ImpactRequest) { r.AfterTargetRevision = before.Revision }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := impactRequest(before, after, 100)
			tc.change(&r)
			if _, err := s.ReferenceImpact(context.Background(), r); err == nil {
				t.Fatal("invalid impact accepted")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.ReferenceImpact(ctx, impactRequest(before, after, 100)); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel %v", err)
	}
	max := s.config.MaxFacts
	s.config.MaxFacts = 1
	if _, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 1)); err == nil {
		t.Fatal("truncated input accepted")
	}
	s.config.MaxFacts = max
	provider := s.config.Provider
	s.config.Provider = nil
	if _, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 1)); err == nil {
		t.Fatal("offline accepted")
	}
	s.config.Provider = provider
	if _, err := s.db.Exec("UPDATE ci_graph_facts SET payload=replace(CAST(payload AS TEXT),'occurs_at','tampered') WHERE snapshot_id=?", before.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 100)); err == nil {
		t.Fatal("corrupt accepted")
	}
	_ = f
}

func TestReferenceImpactEndpointChangesAndCoverage(t *testing.T) {
	for _, mode := range []string{"delete", "rename", "add", "all-changed", "unindexed", "empty-indexed", "same-tree-sv"} {
		t.Run(mode, func(t *testing.T) {
			s, _, before, f := impactFixture(t)
			switch mode {
			case "delete":
				delete(f.sources, "a.go")
				if err := os.Remove(filepath.Join(f.checkout, "a.go")); err != nil {
					t.Fatal(err)
				}
				f.index.Documents = f.index.Documents[1:]
			case "rename":
				f.sources["moved.go"] = f.sources["a.go"]
				delete(f.sources, "a.go")
				if err := os.Rename(filepath.Join(f.checkout, "a.go"), filepath.Join(f.checkout, "moved.go")); err != nil {
					t.Fatal(err)
				}
				f.index.Documents[0].RelativePath = "moved.go"
			case "add":
				f.sources["new.go"] = []byte("var alpha\n")
				f.index.Documents = append(f.index.Documents, &wire.Document{RelativePath: "new.go", Occurrences: []*wire.Occurrence{{Range: []int32{0, 4, 9}, Symbol: "scip-go gomod example.org/pkg v1 alpha().", SymbolRoles: 1}}})
			case "all-changed":
				f.sources["a.go"] = append(f.sources["a.go"], []byte("// A\n")...)
				f.sources["b.go"] = append(f.sources["b.go"], []byte("// B\n")...)
			case "unindexed":
				f.sources["deps.txt"] = []byte("dependency-v2")
			case "empty-indexed":
				f.sources["empty.go"] = []byte("// no symbols\n")
				f.index.Documents = append(f.index.Documents, &wire.Document{RelativePath: "empty.go"})
			}
			if mode != "same-tree-sv" {
				f.bundle(nil)
			}
			revision := f.commit("endpoint C sv:cccccccccccccccccccccccccccccccc")
			after, err := s.Import(context.Background(), revision, "index.scip", "manifest.json")
			if err != nil {
				t.Fatal(err)
			}
			got, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 100))
			if err != nil {
				t.Fatal(err)
			}
			count := map[string]int{}
			for _, w := range got.Witnesses {
				count[w.Side]++
			}
			switch mode {
			case "delete":
				if count["before"] != 2 || count["after"] != 0 || !reflect.DeepEqual(got.After.Coverage.AbsentPaths, []string{"a.go"}) {
					t.Fatalf("deleted definitions %+v", got)
				}
			case "rename":
				if count["before"] != 2 || count["after"] != 2 || !reflect.DeepEqual(got.Before.Coverage.AbsentPaths, []string{"moved.go"}) || !reflect.DeepEqual(got.After.Coverage.AbsentPaths, []string{"a.go"}) {
					t.Fatalf("renamed definitions %+v", got)
				}
			case "add":
				if count["before"] != 0 || count["after"] != 3 || !reflect.DeepEqual(got.Before.Coverage.AbsentPaths, []string{"new.go"}) {
					t.Fatalf("added definitions %+v", got)
				}
			case "empty-indexed":
				if got.Total != 0 || !reflect.DeepEqual(got.After.Coverage.IndexedPaths, []string{"empty.go"}) {
					t.Fatalf("empty indexed doc misclassified %+v", got)
				}
			case "same-tree-sv":
				if got.Total != 0 || len(got.Changes) != 0 || got.After.TargetSVRef != strings.Repeat("c", 32) {
					t.Fatalf("same-tree metadata %+v", got)
				}
				reused := impactRequest(before, before, 100)
				reused.AfterTargetRevision = revision
				historical, err := s.ReferenceImpact(context.Background(), reused)
				if err != nil || historical.After.Snapshot.Revision != before.Revision || historical.After.TargetRevision.Hash != revision || historical.After.TargetSVRef != strings.Repeat("c", 32) {
					t.Fatalf("origin/target collapsed %+v %v", historical, err)
				}
			default:
				if got.Total != 0 || len(got.AffectedFiles) != 0 {
					t.Fatalf("changed/unindexed files fabricated refs %+v", got)
				}
			}
		})
	}
}

func TestReferenceImpactModernNativeFixture(t *testing.T) {
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
	a := f.commit("modern impact A")
	s, err := Open(Config{Provider: f.provider(), MetadataPath: filepath.Join(t.TempDir(), "metadata.sqlite"), RepositoryID: "impact-modern", Profile: ProfileModernUTF8, MaxIndexBytes: 1 << 20, MaxManifestBytes: 1 << 20, MaxSourceBytes: 1 << 20, MaxFacts: 1000})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	before, err := s.Import(context.Background(), a, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	f.sources["math.go"] = append(f.sources["math.go"], []byte("// comment only\n")...)
	modernBundle(t, f, raw)
	b := f.commit("modern impact B")
	after, err := s.Import(context.Background(), b, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.ReferenceImpact(context.Background(), impactRequest(before, after, 100))
	if err != nil {
		t.Fatal(err)
	}
	if got.Total != 2 || !reflect.DeepEqual(got.AffectedFiles, []string{"use.go"}) || !reflect.DeepEqual(got.Before.Coverage.IndexedPaths, []string{"math.go"}) {
		t.Fatalf("modern impact %+v", got)
	}
	for _, witness := range got.Witnesses {
		if witness.Reference.Origin.DocumentPath != "use.go" || len(witness.Definitions) != 1 || witness.Definitions[0].Origin.DocumentPath != "math.go" {
			t.Fatalf("modern witness %+v", witness)
		}
	}
}
