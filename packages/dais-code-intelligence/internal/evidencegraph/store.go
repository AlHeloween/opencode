package evidencegraph

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"dais.local/codeintelligence/internal/fossil"
	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("graph snapshot not found")
var shaPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var svPattern = regexp.MustCompile(`\bsv:[a-fA-F0-9]{32}\b`)

type Store struct {
	config           Config
	db               *sql.DB
	instrumentSHA256 string
}

var executedInstrument = sync.OnceValues(func() (string, error) {
	name, err := os.Executable()
	if err != nil {
		return "", err
	}
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	digest := sha256.New()
	_, copyErr := io.Copy(digest, file)
	if err := errors.Join(copyErr, file.Close()); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
})

type sourceBundle struct {
	manifest Manifest
	files    map[string]fossil.File
	contents map[string][]byte
}

func Open(config Config) (*Store, error) {
	if config.RepositoryID == "" || !filepath.IsAbs(config.MetadataPath) || (config.Profile != ProfileUTF8 && config.Profile != ProfileModernUTF8) || config.MaxIndexBytes <= 0 || config.MaxManifestBytes <= 0 || config.MaxSourceBytes <= 0 || config.MaxFacts <= 0 {
		return nil, errors.New("explicit repository namespace, absolute metadata path, supported profile and positive bounds required")
	}
	instrument, err := executedInstrument()
	if err != nil {
		return nil, fmt.Errorf("executed instrument SHA256: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(config.MetadataPath), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", config.MetadataPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS ci_graph_snapshots(id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,snapshot_json BLOB NOT NULL,index_bytes BLOB NOT NULL,manifest_bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS ci_graph_facts(snapshot_id TEXT NOT NULL,fact_id TEXT NOT NULL,ordinal INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(snapshot_id,fact_id));
CREATE TABLE IF NOT EXISTS ci_graph_current(repository_id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ci_graph_receipts(id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL,receipt_json BLOB NOT NULL);`)
	if err != nil {
		return nil, errors.Join(err, db.Close())
	}
	return &Store{config: config, db: db, instrumentSHA256: instrument}, nil
}

func (s *Store) Close() error { return s.db.Close() }
func hash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func canonicalHash(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return hash(append([]byte("dais-canonical-json-v1\x00"), data...))
}
func snapshotID(snapshot Snapshot) string { snapshot.ID = ""; return canonicalHash(snapshot) }

func factID(snapshotID string, fact Fact) string {
	fact.ID = ""
	return canonicalHash(struct {
		SnapshotID string
		Fact       Fact
	}{snapshotID, fact})
}

func (s *Store) Current(ctx context.Context) (Snapshot, error) {
	var id string
	if err := s.db.QueryRowContext(ctx, "SELECT snapshot_id FROM ci_graph_current WHERE repository_id=?", s.config.RepositoryID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Snapshot{}, ErrNotFound
		}
		return Snapshot{}, err
	}
	snapshot, _, _, err := s.load(ctx, id)
	return snapshot, err
}

func (s *Store) load(ctx context.Context, id string) (Snapshot, []byte, []byte, error) {
	var encoded, raw, manifest []byte
	err := s.db.QueryRowContext(ctx, "SELECT snapshot_json,index_bytes,manifest_bytes FROM ci_graph_snapshots WHERE id=? AND repository_id=?", id, s.config.RepositoryID).Scan(&encoded, &raw, &manifest)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			err = ErrNotFound
		}
		return Snapshot{}, nil, nil, err
	}
	var snapshot Snapshot
	if err := json.Unmarshal(encoded, &snapshot); err != nil {
		return Snapshot{}, nil, nil, err
	}
	if snapshot.ID != id || snapshotID(snapshot) != id || hash(raw) != snapshot.IndexSHA256 || hash(manifest) != snapshot.ManifestSHA256 {
		return Snapshot{}, nil, nil, errors.New("stored graph snapshot digest mismatch")
	}
	if snapshot.Profile != s.config.Profile {
		return Snapshot{}, nil, nil, fmt.Errorf("stored graph profile %q does not match configured profile %q", snapshot.Profile, s.config.Profile)
	}
	return snapshot, raw, manifest, nil
}

func (s *Store) Import(ctx context.Context, revision, indexPath, manifestPath string) (snapshot Snapshot, err error) {
	defer func() {
		if err != nil {
			receiptCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
			defer cancel()
			current, currentErr := s.Current(receiptCtx)
			if currentErr != nil && !errors.Is(currentErr, ErrNotFound) {
				err = errors.Join(err, currentErr)
				return
			}
			receipt := Receipt{SnapshotID: current.ID, TargetRevision: revision, Predicate: "import_validation_v1", Result: "FAIL", SemanticStatus: "unknown", Details: err.Error()}
			if saveErr := s.saveReceipt(receiptCtx, &receipt); saveErr != nil {
				err = errors.Join(err, saveErr)
			}
		}
	}()
	if s.config.Provider == nil {
		return Snapshot{}, errors.New("import requires a Fossil provider")
	}
	if !validPath(indexPath) || !validPath(manifestPath) || indexPath == manifestPath {
		return Snapshot{}, errors.New("distinct canonical index and manifest paths required")
	}
	head, err := s.config.Provider.Head(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	if head.Hash != revision {
		return Snapshot{}, errors.New("canonical provider head does not match import revision")
	}
	raw, err := s.config.Provider.ReadFile(ctx, revision, indexPath)
	if err != nil {
		return Snapshot{}, err
	}
	if int64(len(raw)) > s.config.MaxIndexBytes {
		return Snapshot{}, errors.New("SCIP index exceeds input bound")
	}
	manifestBytes, err := s.config.Provider.ReadFile(ctx, revision, manifestPath)
	if err != nil {
		return Snapshot{}, err
	}
	if int64(len(manifestBytes)) > s.config.MaxManifestBytes {
		return Snapshot{}, errors.New("manifest exceeds input bound")
	}
	bundle, err := s.inputs(ctx, revision, indexPath, manifestPath, manifestBytes)
	if err != nil {
		return Snapshot{}, err
	}
	if bundle.manifest.IndexSHA256 != hash(raw) {
		return Snapshot{}, errors.New("manifest index SHA256 mismatch")
	}
	snapshot = Snapshot{RepositoryID: s.config.RepositoryID, Revision: revision, IndexPath: indexPath, ManifestPath: manifestPath, IndexSHA256: hash(raw), ManifestSHA256: hash(manifestBytes), InputDigest: canonicalHash(bundle.manifest.Inputs), Profile: s.config.Profile, Comment: head.Comment, SVRef: svPattern.FindString(head.Comment)}
	snapshot.SVRef = strings.ToLower(strings.TrimPrefix(snapshot.SVRef, "sv:"))
	facts, err := s.project(raw, snapshot, bundle)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.FactCount = len(facts)
	snapshot.ID = snapshotID(snapshot)
	for i := range facts {
		facts[i].ID = factID(snapshot.ID, facts[i])
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return Snapshot{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO ci_graph_snapshots VALUES(?,?,?,?,?)", snapshot.ID, s.config.RepositoryID, encoded, raw, manifestBytes)
	if err != nil {
		return Snapshot{}, err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return Snapshot{}, err
	}
	if inserted > 0 {
		for i, fact := range facts {
			payload, err := json.Marshal(fact)
			if err != nil {
				return Snapshot{}, err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO ci_graph_facts VALUES(?,?,?,?)", snapshot.ID, fact.ID, i, payload); err != nil {
				return Snapshot{}, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO ci_graph_current VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET snapshot_id=excluded.snapshot_id", s.config.RepositoryID, snapshot.ID); err != nil {
		return Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (s *Store) inputs(ctx context.Context, revision, indexPath, manifestPath string, raw []byte) (sourceBundle, error) {
	var manifest Manifest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return sourceBundle{}, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return sourceBundle{}, errors.New("trailing manifest JSON")
	}
	if manifest.Version != 1 || !shaPattern.MatchString(manifest.IndexSHA256) {
		return sourceBundle{}, errors.New("unsupported manifest version or index hash")
	}
	files, err := s.config.Provider.ListFiles(ctx, revision)
	if err != nil {
		return sourceBundle{}, err
	}
	bundle := sourceBundle{manifest: manifest, files: make(map[string]fossil.File), contents: make(map[string][]byte)}
	for _, file := range files {
		if file.Path != indexPath && file.Path != manifestPath {
			bundle.files[file.Path] = file
		}
	}
	if len(manifest.Inputs) != len(bundle.files) {
		return sourceBundle{}, errors.New("manifest does not cover entire tracked workspace")
	}
	seen := map[string]bool{}
	hashes := make([]string, 0, len(manifest.Inputs))
	for _, input := range manifest.Inputs {
		file, ok := bundle.files[input.Path]
		if !ok || !validPath(input.Path) || !shaPattern.MatchString(input.SHA256) || seen[input.Path] {
			return sourceBundle{}, fmt.Errorf("invalid manifest input %q", input.Path)
		}
		if file.Permissions == "l" {
			return sourceBundle{}, errors.New("symlink input unsupported by this profile")
		}
		seen[input.Path] = true
		hashes = append(hashes, file.Hash)
	}
	artifacts, err := s.readArtifacts(ctx, hashes)
	if err != nil {
		return sourceBundle{}, err
	}
	var total int64
	for _, input := range manifest.Inputs {
		data := artifacts[bundle.files[input.Path].Hash]
		total += int64(len(data))
		if total > s.config.MaxSourceBytes {
			return sourceBundle{}, errors.New("workspace source bytes exceed bound")
		}
		if hash(data) != input.SHA256 {
			return sourceBundle{}, fmt.Errorf("manifest SHA256 mismatch for %q", input.Path)
		}
		bundle.contents[input.Path] = data
	}
	sort.Slice(bundle.manifest.Inputs, func(i, j int) bool { return bundle.manifest.Inputs[i].Path < bundle.manifest.Inputs[j].Path })
	return bundle, nil
}

func (s *Store) readArtifacts(ctx context.Context, hashes []string) (map[string][]byte, error) {
	contents := make(map[string][]byte)
	var total int64
	for start := 0; start < len(hashes); start += 64 {
		end := min(start+64, len(hashes))
		part, err := s.readBatch(ctx, hashes[start:end])
		if err != nil {
			return nil, err
		}
		for key, data := range part {
			if _, exists := contents[key]; !exists {
				total += int64(len(data))
			}
			if total > s.config.MaxSourceBytes {
				return nil, errors.New("workspace source bytes exceed bound")
			}
			contents[key] = data
		}
	}
	return contents, nil
}
func (s *Store) readBatch(ctx context.Context, hashes []string) (map[string][]byte, error) {
	contents, err := s.config.Provider.ReadArtifacts(ctx, hashes)
	if !errors.Is(err, fossil.ErrOutputLimit) || len(hashes) < 2 {
		return contents, err
	}
	mid := len(hashes) / 2
	left, err := s.readBatch(ctx, hashes[:mid])
	if err != nil {
		return nil, err
	}
	right, err := s.readBatch(ctx, hashes[mid:])
	if err != nil {
		return nil, err
	}
	for key, data := range right {
		left[key] = data
	}
	return left, nil
}

func (s *Store) Facts(ctx context.Context, id string, limit int) (FactPage, error) {
	snapshot, _, _, err := s.load(ctx, id)
	if err != nil {
		return FactPage{}, err
	}
	if limit <= 0 || limit > s.config.MaxFacts {
		return FactPage{}, errors.New("fact limit must be positive and within configured bound")
	}
	var actualCount int
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM ci_graph_facts WHERE snapshot_id=?", id).Scan(&actualCount); err != nil {
		return FactPage{}, err
	}
	if actualCount != snapshot.FactCount {
		return FactPage{}, errors.New("stored fact count does not match snapshot")
	}
	rows, err := s.db.QueryContext(ctx, "SELECT payload FROM ci_graph_facts WHERE snapshot_id=? ORDER BY ordinal LIMIT ?", id, limit)
	if err != nil {
		return FactPage{}, err
	}
	defer rows.Close()
	page := FactPage{Facts: []Fact{}, Total: snapshot.FactCount}
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return FactPage{}, err
		}
		var fact Fact
		if err := json.Unmarshal(payload, &fact); err != nil {
			return FactPage{}, err
		}
		if fact.ID != factID(id, fact) {
			return FactPage{}, errors.New("stored fact digest mismatch")
		}
		page.Facts = append(page.Facts, fact)
	}
	if err := rows.Err(); err != nil {
		return FactPage{}, err
	}
	page.Returned = len(page.Facts)
	page.Truncated = page.Returned < page.Total
	return page, nil
}

func (s *Store) saveReceipt(ctx context.Context, receipt *Receipt) error {
	receipt.InstrumentSHA256 = s.instrumentSHA256
	receipt.ID = ""
	receipt.ID = canonicalHash(*receipt)
	data, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, "INSERT OR IGNORE INTO ci_graph_receipts VALUES(?,?,?)", receipt.ID, receipt.SnapshotID, data)
	return err
}

func (s *Store) Verify(ctx context.Context, id, target string) (Receipt, error) {
	if s.config.Provider == nil {
		return Receipt{}, errors.New("verification requires a Fossil provider")
	}
	snapshot, raw, manifest, err := s.load(ctx, id)
	if err != nil {
		return Receipt{}, err
	}
	receipt := Receipt{SnapshotID: id, TargetRevision: target, InputDigest: snapshot.InputDigest, Predicate: "projection_fidelity_ranges_declared_inputs_v1", Result: "PASS", SemanticStatus: "unknown", Details: "SCIP projection and ranges match bound bytes; indexer semantic correctness is unknown"}
	check := func() error {
		original, err := s.config.Provider.ReadFile(ctx, snapshot.Revision, snapshot.IndexPath)
		if err != nil {
			return err
		}
		originalManifest, err := s.config.Provider.ReadFile(ctx, snapshot.Revision, snapshot.ManifestPath)
		if err != nil {
			return err
		}
		if !bytes.Equal(original, raw) || !bytes.Equal(originalManifest, manifest) {
			return errors.New("original Fossil artifact mismatch")
		}
		bundle, err := s.inputs(ctx, snapshot.Revision, snapshot.IndexPath, snapshot.ManifestPath, manifest)
		if err != nil {
			return err
		}
		facts, err := s.project(raw, snapshot, bundle)
		if err != nil {
			return err
		}
		for i := range facts {
			facts[i].ID = factID(id, facts[i])
		}
		page, err := s.Facts(ctx, id, s.config.MaxFacts)
		if err != nil {
			return err
		}
		expected, _ := json.Marshal(facts)
		actual, _ := json.Marshal(page.Facts)
		if len(facts) != snapshot.FactCount || !bytes.Equal(expected, actual) {
			return errors.New("stored fact projection fidelity mismatch")
		}
		return nil
	}
	if err := check(); err != nil {
		if ctx.Err() != nil {
			return Receipt{}, ctx.Err()
		}
		receipt.Result = "FAIL"
		receipt.Details = err.Error()
	} else {
		checkTarget := func() error {
			if _, err := s.inputs(ctx, target, snapshot.IndexPath, snapshot.ManifestPath, manifest); err != nil {
				return err
			}
			targetIndex, err := s.config.Provider.ReadFile(ctx, target, snapshot.IndexPath)
			if err != nil {
				return err
			}
			targetManifest, err := s.config.Provider.ReadFile(ctx, target, snapshot.ManifestPath)
			if err != nil {
				return err
			}
			if hash(targetIndex) != snapshot.IndexSHA256 || hash(targetManifest) != snapshot.ManifestSHA256 {
				return errors.New("target SCIP index or manifest stamp changed")
			}
			return nil
		}
		if err := checkTarget(); err != nil {
			if ctx.Err() != nil {
				return Receipt{}, ctx.Err()
			}
			receipt.Result = "STALE"
			receipt.Details = err.Error()
		}
	}
	if err := s.saveReceipt(ctx, &receipt); err != nil {
		return Receipt{}, err
	}
	return receipt, nil
}

func (s *Store) ExportSCIP(ctx context.Context, id string) ([]byte, error) {
	_, raw, _, err := s.load(ctx, id)
	return raw, err
}

func (s *Store) ExportSCs(ctx context.Context, id string, writer io.Writer) error {
	snapshot, _, _, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	page, err := s.Facts(ctx, id, s.config.MaxFacts)
	if err != nil {
		return err
	}
	receipts, err := s.receipts(ctx, id)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(writer, "// profile %s; engine_compatibility_unknown; current_instrument_sha256 %s\n", s.config.Profile, s.instrumentSHA256); err != nil {
		return err
	}
	if err := scsLink(writer, "snapshot_metadata_"+id, snapshot); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(writer, "sc_node#snapshot_%s | sc_membership_arc#snapshot_metadata_arc_%s | sc_link#snapshot_metadata_%s;;\n", id, id, id); err != nil {
		return err
	}
	entities := map[string]bool{}
	entity := func(value string) (string, error) {
		name := "entity_" + hash([]byte(value))
		if !entities[name] {
			if err := scsLink(writer, name+"_value", value); err != nil {
				return "", err
			}
			if _, err := fmt.Fprintf(writer, "sc_node#%s | sc_membership_arc#%s_value_arc | sc_link#%s_value;;\n", name, name, name); err != nil {
				return "", err
			}
			entities[name] = true
		}
		return name, nil
	}
	for _, fact := range page.Facts {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := scsLink(writer, "fact_"+fact.ID, fact); err != nil {
			return err
		}
		subject, err := entity(fact.Subject)
		if err != nil {
			return err
		}
		object, err := entity(fact.Object)
		if err != nil {
			return err
		}
		predicate := "predicate_" + hash([]byte(fact.Predicate))
		if !entities[predicate] {
			if err := scsLink(writer, predicate+"_value", fact.Predicate); err != nil {
				return err
			}
			if _, err := fmt.Fprintf(writer, "sc_node#%s | sc_membership_arc#%s_value_arc | sc_link#%s_value;;\n", predicate, predicate, predicate); err != nil {
				return err
			}
			entities[predicate] = true
		}
		if err := scsLink(writer, "origin_"+fact.ID, fact.Origin); err != nil {
			return err
		}
		if _, err := fmt.Fprintf(writer, "sc_node#%s | sc_common_arc#edge_%s | sc_node#%s;;\nsc_node#%s | sc_membership_arc#predicate_arc_%s | sc_common_arc#edge_%s;;\nsc_node#claim_%s | sc_membership_arc#claim_edge_%s | sc_common_arc#edge_%s;;\nsc_node#claim_%s | sc_membership_arc#claim_payload_%s | sc_link#fact_%s;;\nsc_node#claim_%s | sc_membership_arc#claim_origin_%s | sc_link#origin_%s;;\nsc_node#snapshot_%s | sc_membership_arc#snapshot_claim_%s | sc_node#claim_%s;;\n", subject, fact.ID, object, predicate, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, fact.ID, id, fact.ID, fact.ID); err != nil {
			return err
		}
	}
	for _, receipt := range receipts {
		if err := scsLink(writer, "receipt_metadata_"+receipt.ID, receipt); err != nil {
			return err
		}
		if _, err := fmt.Fprintf(writer, "sc_node#receipt_%s | sc_membership_arc#receipt_metadata_arc_%s | sc_link#receipt_metadata_%s;;\nsc_node#snapshot_%s | sc_membership_arc#snapshot_receipt_%s | sc_node#receipt_%s;;\n", receipt.ID, receipt.ID, receipt.ID, id, receipt.ID, receipt.ID); err != nil {
			return err
		}
		for _, fact := range page.Facts {
			if _, err := fmt.Fprintf(writer, "sc_node#receipt_%s | sc_membership_arc#receipt_claim_%s_%s | sc_node#claim_%s;;\n", receipt.ID, receipt.ID, fact.ID, fact.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) receipts(ctx context.Context, id string) ([]Receipt, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,receipt_json FROM ci_graph_receipts WHERE snapshot_id=? ORDER BY id", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	receipts := []Receipt{}
	for rows.Next() {
		var key string
		var data []byte
		if err := rows.Scan(&key, &data); err != nil {
			return nil, err
		}
		var receipt Receipt
		if err := json.Unmarshal(data, &receipt); err != nil {
			return nil, err
		}
		originalID := receipt.ID
		receipt.ID = ""
		if originalID != key || receipt.SnapshotID != id || canonicalHash(receipt) != key {
			return nil, errors.New("stored receipt digest mismatch")
		}
		receipt.ID = originalID
		receipts = append(receipts, receipt)
	}
	return receipts, rows.Err()
}

func scsLink(writer io.Writer, name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	text := strings.NewReplacer("\\", "\\\\", "]", "\\]").Replace(string(data))
	_, err = fmt.Fprintf(writer, "%s = [%s];;\n", name, text)
	return err
}
