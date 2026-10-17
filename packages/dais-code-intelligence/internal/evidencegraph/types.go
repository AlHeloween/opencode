// Package evidencegraph stores derived, revision-pinned SCIP projections.
package evidencegraph

import (
	"encoding/json"

	"dais.local/codeintelligence/internal/fossil"
)

const ProfileUTF8 = "dais-scip-utf8-v1"
const ProfileModernUTF8 = "dais-scip-modern-utf8-v1"

type Config struct {
	Provider         *fossil.Provider
	MetadataPath     string
	RepositoryID     string
	Profile          string
	MaxIndexBytes    int64
	MaxManifestBytes int64
	MaxSourceBytes   int64
	MaxFacts         int
}

type Input struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	Version     int     `json:"version"`
	IndexSHA256 string  `json:"index_sha256"`
	Inputs      []Input `json:"inputs"`
}

type Snapshot struct {
	ID             string `json:"id"`
	RepositoryID   string `json:"repository_id"`
	Revision       string `json:"revision"`
	IndexPath      string `json:"index_path"`
	ManifestPath   string `json:"manifest_path"`
	IndexSHA256    string `json:"index_sha256"`
	ManifestSHA256 string `json:"manifest_sha256"`
	InputDigest    string `json:"input_digest"`
	Profile        string `json:"profile"`
	Comment        string `json:"comment"`
	SVRef          string `json:"sv_ref"`
	FactCount      int    `json:"fact_count"`
}

type Origin struct {
	IndexSHA256  string `json:"index_sha256"`
	Address      string `json:"address"`
	DocumentPath string `json:"document_path,omitempty"`
	FileHash     string `json:"file_hash,omitempty"`
}

type Fact struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Subject   string          `json:"subject"`
	Predicate string          `json:"predicate"`
	Object    string          `json:"object"`
	Origin    Origin          `json:"origin"`
	Payload   json.RawMessage `json:"payload"`
}

type FactPage struct {
	Facts     []Fact `json:"facts"`
	Total     int    `json:"total"`
	Returned  int    `json:"returned"`
	Truncated bool   `json:"truncated"`
}

type Receipt struct {
	InstrumentSHA256 string `json:"instrument_sha256"`
	ID               string `json:"id"`
	SnapshotID       string `json:"snapshot_id"`
	TargetRevision   string `json:"target_revision"`
	InputDigest      string `json:"input_digest"`
	Predicate        string `json:"predicate"`
	Result           string `json:"result"`
	SemanticStatus   string `json:"semantic_status"`
	Details          string `json:"details"`
}
