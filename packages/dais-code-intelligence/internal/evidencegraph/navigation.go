package evidencegraph

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

type NavigationMode string

const (
	Definitions NavigationMode = "definitions"
	References  NavigationMode = "references"
)

type Position struct {
	DocumentPath string `json:"document_path"`
	Line         int    `json:"line"`
	Character    int    `json:"character"`
}

type NavigationResult struct {
	Snapshot       Snapshot `json:"snapshot"`
	Symbols        []string `json:"symbols"`
	Locations      []Fact   `json:"locations"`
	Total          int      `json:"total"`
	Returned       int      `json:"returned"`
	Truncated      bool     `json:"truncated"`
	SemanticStatus string   `json:"semantic_status"`
}

type navigationOccurrence struct {
	fact        Fact
	rangeBounds [4]int32
	symbol      string
	roles       int32
}

// Navigate selects coordinates within a pinned occurrence projection. Positions
// use zero-based UTF8 byte offsets; this offline query does not read source text.
func (s *Store) Navigate(ctx context.Context, id string, position Position, mode NavigationMode, limit int) (NavigationResult, error) {
	if mode != Definitions && mode != References {
		return NavigationResult{}, errors.New("navigation mode must be definitions or references")
	}
	if !validPath(position.DocumentPath) || position.Line < 0 || position.Character < 0 {
		return NavigationResult{}, errors.New("canonical document path and nonnegative navigation position required")
	}
	if limit <= 0 || limit > s.config.MaxFacts {
		return NavigationResult{}, errors.New("navigation limit must be positive and within configured fact bound")
	}
	snapshot, _, _, err := s.load(ctx, id)
	if err != nil {
		return NavigationResult{}, err
	}
	page, err := s.Facts(ctx, id, s.config.MaxFacts)
	if err != nil {
		return NavigationResult{}, err
	}
	if page.Truncated {
		return NavigationResult{}, errors.New("navigation requires a complete bounded fact snapshot")
	}
	result := NavigationResult{Snapshot: snapshot, Symbols: []string{}, Locations: []Fact{}, SemanticStatus: "unknown"}
	occurrences := make([]navigationOccurrence, 0, len(page.Facts))
	targets := map[string]bool{}
	for _, fact := range page.Facts {
		if err := ctx.Err(); err != nil {
			return NavigationResult{}, err
		}
		if fact.Kind != "occurrence" {
			continue
		}
		var payload struct {
			Range       []int32 `json:"range"`
			Symbol      string  `json:"symbol"`
			SymbolRoles int32   `json:"symbol_roles"`
		}
		if err := json.Unmarshal(fact.Payload, &payload); err != nil {
			return NavigationResult{}, fmt.Errorf("occurrence %s payload: %w", fact.ID, err)
		}
		if len(payload.Range) != 3 && len(payload.Range) != 4 {
			return NavigationResult{}, fmt.Errorf("occurrence %s has invalid range shape", fact.ID)
		}
		bounds := modernRangeBounds(payload.Range)
		if bounds[0] < 0 || bounds[1] < 0 || bounds[2] < bounds[0] || bounds[3] < 0 || (bounds[0] == bounds[2] && bounds[3] < bounds[1]) || payload.SymbolRoles < 0 {
			return NavigationResult{}, fmt.Errorf("occurrence %s has invalid range or roles", fact.ID)
		}
		if !validPath(fact.Origin.DocumentPath) {
			return NavigationResult{}, fmt.Errorf("occurrence %s has invalid document path", fact.ID)
		}
		key := ""
		if payload.Symbol != "" {
			key, err = s.symbolKey(snapshot.IndexSHA256, fact.Origin.DocumentPath, payload.Symbol)
			if err != nil {
				return NavigationResult{}, err
			}
		}
		if key != fact.Object {
			return NavigationResult{}, fmt.Errorf("occurrence %s symbol identity mismatch", fact.ID)
		}
		occurrence := navigationOccurrence{fact: fact, rangeBounds: bounds, symbol: payload.Symbol, roles: payload.SymbolRoles}
		occurrences = append(occurrences, occurrence)
		if fact.Origin.DocumentPath == position.DocumentPath && fact.Object != "" && containsPosition(bounds, position) {
			targets[fact.Object] = true
		}
	}
	for key := range targets {
		result.Symbols = append(result.Symbols, key)
	}
	sort.Strings(result.Symbols)
	for _, occurrence := range occurrences {
		if err := ctx.Err(); err != nil {
			return NavigationResult{}, err
		}
		if occurrence.symbol == "" || !targets[occurrence.fact.Object] {
			continue
		}
		definition := occurrence.roles&1 != 0
		if (mode == Definitions) != definition {
			continue
		}
		result.Total++
		if len(result.Locations) < limit {
			result.Locations = append(result.Locations, occurrence.fact)
		}
	}
	if err := ctx.Err(); err != nil {
		return NavigationResult{}, err
	}
	result.Returned = len(result.Locations)
	result.Truncated = result.Returned < result.Total
	return result, nil
}

func containsPosition(bounds [4]int32, position Position) bool {
	startLine, startCharacter, endLine, endCharacter := int(bounds[0]), int(bounds[1]), int(bounds[2]), int(bounds[3])
	afterStart := position.Line > startLine || (position.Line == startLine && position.Character >= startCharacter)
	beforeEnd := position.Line < endLine || (position.Line == endLine && position.Character < endCharacter)
	return afterStart && beforeEnd
}
