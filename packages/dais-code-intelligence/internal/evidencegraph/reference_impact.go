package evidencegraph

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"dais.local/codeintelligence/internal/fossil"
)

type ImpactRequest struct {
	BeforeSnapshotID     string `json:"before_snapshot_id"`
	BeforeTargetRevision string `json:"before_target_revision"`
	AfterSnapshotID      string `json:"after_snapshot_id"`
	AfterTargetRevision  string `json:"after_target_revision"`
	Limit                int    `json:"limit"`
}

type ImpactCoverage struct {
	IndexedPaths         []string `json:"indexed_paths"`
	UnindexedPaths       []string `json:"unindexed_paths"`
	AbsentPaths          []string `json:"absent_paths"`
	ChangedDefinitions   int      `json:"changed_definitions"`
	MatchingReferences   int      `json:"matching_references"`
	UnboundReferences    int      `json:"unbound_references"`
	UnresolvedReferences int      `json:"unresolved_references"`
}

type ImpactSide struct {
	Snapshot       Snapshot        `json:"snapshot"`
	TargetRevision fossil.Revision `json:"target_revision"`
	TargetSVRef    string          `json:"target_sv_ref"`
	Verification   Receipt         `json:"verification"`
	Coverage       ImpactCoverage  `json:"coverage"`
}

type ImpactChange struct {
	Kind   fossil.ChangeKind `json:"kind"`
	Path   string            `json:"path"`
	Before *fossil.File      `json:"before"`
	After  *fossil.File      `json:"after"`
}

type ImpactWitness struct {
	Side        string `json:"side"`
	Reference   Fact   `json:"reference"`
	Definitions []Fact `json:"definitions"`
}

type ReferenceImpactResult struct {
	Profile        string          `json:"profile"`
	SemanticStatus string          `json:"semantic_status"`
	Before         ImpactSide      `json:"before"`
	After          ImpactSide      `json:"after"`
	Changes        []ImpactChange  `json:"changes"`
	Witnesses      []ImpactWitness `json:"witnesses"`
	AffectedFiles  []string        `json:"affected_files"`
	Total          int             `json:"total"`
	Returned       int             `json:"returned"`
	Truncated      bool            `json:"truncated"`
	Complete       bool            `json:"complete"`
}

// ReferenceImpact finds direct SCIP references outside the changed path set.
// Completeness is confined to the pinned, bounded direct-reference profile.
func (s *Store) ReferenceImpact(ctx context.Context, request ImpactRequest) (ReferenceImpactResult, error) {
	if s.config.Provider == nil {
		return ReferenceImpactResult{}, errors.New("reference impact requires a Fossil provider")
	}
	if request.Limit <= 0 || request.Limit > s.config.MaxFacts {
		return ReferenceImpactResult{}, errors.New("impact limit must be positive and within configured fact bound")
	}
	before, beforeFacts, err := s.impactSide(ctx, request.BeforeSnapshotID, request.BeforeTargetRevision)
	if err != nil {
		return ReferenceImpactResult{}, fmt.Errorf("before impact endpoint: %w", err)
	}
	after, afterFacts, err := s.impactSide(ctx, request.AfterSnapshotID, request.AfterTargetRevision)
	if err != nil {
		return ReferenceImpactResult{}, fmt.Errorf("after impact endpoint: %w", err)
	}
	changes, err := s.config.Provider.Changes(ctx, before.TargetRevision.Hash, after.TargetRevision.Hash)
	if err != nil {
		return ReferenceImpactResult{}, err
	}
	result := ReferenceImpactResult{Profile: "direct_scip_references_v1", SemanticStatus: "unknown", Before: before, After: after, Changes: []ImpactChange{}, Witnesses: []ImpactWitness{}, AffectedFiles: []string{}}
	changed := make(map[string]bool, len(changes))
	for _, change := range changes {
		changed[change.Path] = true
		result.Changes = append(result.Changes, ImpactChange{Kind: change.Kind, Path: change.Path, Before: change.Before, After: change.After})
	}
	affected := map[string]bool{}
	for _, input := range []struct {
		name  string
		side  *ImpactSide
		facts []Fact
	}{{"before", &result.Before, beforeFacts}, {"after", &result.After, afterFacts}} {
		if err := s.scanImpact(ctx, input.name, input.side, input.facts, changes, changed, affected, request.Limit, &result); err != nil {
			return ReferenceImpactResult{}, err
		}
	}
	for name := range affected {
		result.AffectedFiles = append(result.AffectedFiles, name)
	}
	sort.Strings(result.AffectedFiles)
	result.Returned = len(result.Witnesses)
	result.Truncated = result.Returned < result.Total
	result.Complete = !result.Truncated
	if err := ctx.Err(); err != nil {
		return ReferenceImpactResult{}, err
	}
	return result, nil
}

func (s *Store) impactSide(ctx context.Context, id, target string) (ImpactSide, []Fact, error) {
	revision, err := s.config.Provider.Revision(ctx, target)
	if err != nil {
		return ImpactSide{}, nil, err
	}
	snapshot, _, _, err := s.load(ctx, id)
	if err != nil {
		return ImpactSide{}, nil, err
	}
	receipt, err := s.Verify(ctx, id, revision.Hash)
	if err != nil {
		return ImpactSide{}, nil, err
	}
	if receipt.Result != "PASS" {
		return ImpactSide{}, nil, fmt.Errorf("verification %s; retained receipt %s: %s", receipt.Result, receipt.ID, receipt.Details)
	}
	page, err := s.Facts(ctx, id, s.config.MaxFacts)
	if err != nil {
		return ImpactSide{}, nil, err
	}
	if page.Truncated {
		return ImpactSide{}, nil, errors.New("reference impact requires complete bounded fact snapshots")
	}
	return ImpactSide{Snapshot: snapshot, TargetRevision: revision, TargetSVRef: strings.ToLower(strings.TrimPrefix(svPattern.FindString(revision.Comment), "sv:")), Verification: receipt, Coverage: ImpactCoverage{IndexedPaths: []string{}, UnindexedPaths: []string{}, AbsentPaths: []string{}}}, page.Facts, nil
}

func (s *Store) scanImpact(ctx context.Context, side string, endpoint *ImpactSide, facts []Fact, changes []fossil.Change, changed, affected map[string]bool, limit int, result *ReferenceImpactResult) error {
	indexed := map[string]bool{}
	_, raw, _, err := s.load(ctx, endpoint.Snapshot.ID)
	if err != nil {
		return err
	}
	if endpoint.Snapshot.Profile == ProfileModernUTF8 {
		index, err := decodeModernIndex(raw)
		if err != nil {
			return err
		}
		documents := modernField(index, "documents").List()
		for i := 0; i < documents.Len(); i++ {
			indexed[modernField(documents.Get(i).Message(), "relative_path").String()] = true
		}
	} else {
		index, err := decodeIndex(raw)
		if err != nil {
			return err
		}
		for _, document := range index.Documents {
			indexed[document.RelativePath] = true
		}
	}
	definitions := map[string][]Fact{}
	allDefinitions := map[string]bool{}
	roles := make(map[string]int32)
	for _, fact := range facts {
		if err := ctx.Err(); err != nil {
			return err
		}
		if fact.Kind != "occurrence" {
			continue
		}
		var payload struct {
			SymbolRoles int32 `json:"symbol_roles"`
		}
		if err := json.Unmarshal(fact.Payload, &payload); err != nil {
			return err
		}
		roles[fact.ID] = payload.SymbolRoles
		if payload.SymbolRoles&1 == 0 || fact.Object == "" {
			continue
		}
		allDefinitions[fact.Object] = true
		if changed[fact.Origin.DocumentPath] {
			definitions[fact.Object] = append(definitions[fact.Object], fact)
			endpoint.Coverage.ChangedDefinitions++
		}
	}
	for _, change := range changes {
		exists := change.Before != nil
		if side == "after" {
			exists = change.After != nil
		}
		switch {
		case !exists:
			endpoint.Coverage.AbsentPaths = append(endpoint.Coverage.AbsentPaths, change.Path)
		case indexed[change.Path]:
			endpoint.Coverage.IndexedPaths = append(endpoint.Coverage.IndexedPaths, change.Path)
		default:
			endpoint.Coverage.UnindexedPaths = append(endpoint.Coverage.UnindexedPaths, change.Path)
		}
	}
	for _, fact := range facts {
		if err := ctx.Err(); err != nil {
			return err
		}
		if fact.Kind != "occurrence" || roles[fact.ID]&1 != 0 {
			continue
		}
		if fact.Object == "" {
			endpoint.Coverage.UnboundReferences++
			continue
		}
		if !allDefinitions[fact.Object] {
			endpoint.Coverage.UnresolvedReferences++
		}
		if changed[fact.Origin.DocumentPath] || len(definitions[fact.Object]) == 0 {
			continue
		}
		result.Total++
		endpoint.Coverage.MatchingReferences++
		affected[fact.Origin.DocumentPath] = true
		if len(result.Witnesses) < limit {
			result.Witnesses = append(result.Witnesses, ImpactWitness{Side: side, Reference: fact, Definitions: definitions[fact.Object]})
		}
	}
	return nil
}

// ValidateReferenceImpactSize checks the encoded response, including its final
// newline, without expanding repeated definition witnesses into a JSON buffer.
func ValidateReferenceImpactSize(value ReferenceImpactResult, maximum int) error {
	if maximum <= 0 {
		return errors.New("positive impact response byte bound required")
	}
	base := value
	if value.Witnesses != nil {
		base.Witnesses = []ImpactWitness{}
	}
	encoded, err := json.Marshal(base)
	if err != nil {
		return err
	}
	if len(encoded) >= maximum {
		return errors.New("reference-impact response exceeds configured byte bound")
	}
	remaining := maximum - len(encoded) - 1
	consume := func(size int) error {
		if size < 0 || size > remaining {
			return errors.New("reference-impact response exceeds configured byte bound")
		}
		remaining -= size
		return nil
	}
	type cachedFact struct {
		fact Fact
		size int
	}
	cache := map[string]cachedFact{}
	factSize := func(fact Fact) (int, error) {
		if cached, ok := cache[fact.ID]; ok {
			if !reflect.DeepEqual(cached.fact, fact) {
				return 0, errors.New("inconsistent fact identity in impact response")
			}
			return cached.size, nil
		}
		data, err := json.Marshal(fact)
		if err != nil {
			return 0, err
		}
		cache[fact.ID] = cachedFact{fact: fact, size: len(data)}
		return len(data), nil
	}
	for i, witness := range value.Witnesses {
		if i > 0 {
			if err := consume(1); err != nil {
				return err
			}
		}
		skeleton := struct {
			Side        string          `json:"side"`
			Reference   json.RawMessage `json:"reference"`
			Definitions []Fact          `json:"definitions"`
		}{Side: witness.Side}
		if witness.Definitions != nil {
			skeleton.Definitions = []Fact{}
		}
		data, err := json.Marshal(skeleton)
		if err != nil {
			return err
		}
		if err := consume(len(data) - len("null")); err != nil {
			return err
		}
		size, err := factSize(witness.Reference)
		if err != nil {
			return err
		}
		if err := consume(size); err != nil {
			return err
		}
		for j, definition := range witness.Definitions {
			if j > 0 {
				if err := consume(1); err != nil {
					return err
				}
			}
			size, err := factSize(definition)
			if err != nil {
				return err
			}
			if err := consume(size); err != nil {
				return err
			}
		}
	}
	return nil
}
