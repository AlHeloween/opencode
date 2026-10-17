package search

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"regexp/syntax"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"dais.local/codeintelligence/internal/fossil"
	"github.com/sourcegraph/zoekt"
	"github.com/sourcegraph/zoekt/index"
	"github.com/sourcegraph/zoekt/query"
	zoektsearch "github.com/sourcegraph/zoekt/search"
	_ "modernc.org/sqlite"
)

var (
	ErrNotIndexed          = errors.New("no published index")
	ErrConfigMismatch      = errors.New("delta configuration differs from published generation")
	ErrPublicationConflict = errors.New("published generation changed during indexing")
)

type Config struct {
	IndexRoot        string
	RepositoryID     string
	Provider         *fossil.Provider
	Exclude          []string
	MaxFileBytes     int
	MaxQueryBytes    int
	MaxResults       int
	MaxResponseBytes int
	QueryTimeout     time.Duration
}
type Snapshot struct {
	Generation   string
	RepositoryID string
	Revision     string
	SVRef        string
	IndexedFiles int
	OmittedFiles int
}
type Request struct {
	Kind, Query string
	Limit       int
}
type Match struct {
	Generation, RepositoryID, Revision, SVRef string
	Path, ArtifactHash                        string
	Line                                      int
	Content                                   string
}
type Response struct {
	Snapshot  Snapshot
	Results   []Match
	Complete  bool
	Truncated bool
	Stats     zoekt.Stats
}
type Adapter struct {
	config      Config
	fingerprint string
	db          *sql.DB
	mu          sync.Mutex
	searchers   map[string]zoekt.Streamer
	closed      bool
}
type fileRow struct{ path, hash, permissions, reason string }

func New(c Config) (*Adapter, error) {
	if c.IndexRoot == "" || !filepath.IsAbs(c.IndexRoot) || c.RepositoryID == "" {
		return nil, errors.New("absolute IndexRoot and RepositoryID are required")
	}
	if c.MaxFileBytes == 0 {
		c.MaxFileBytes = 1 << 20
	}
	if c.MaxQueryBytes == 0 {
		c.MaxQueryBytes = 4096
	}
	if c.MaxResults == 0 {
		c.MaxResults = 100
	}
	if c.MaxResponseBytes == 0 {
		c.MaxResponseBytes = 1 << 20
	}
	if c.QueryTimeout == 0 {
		c.QueryTimeout = 5 * time.Second
	}
	if c.MaxFileBytes < 1 || c.MaxQueryBytes < 1 || c.MaxResults < 1 || c.MaxResults > 100000 || c.MaxResponseBytes < 1 || c.QueryTimeout < 0 {
		return nil, errors.New("invalid positive limits (MaxResults must be <=100000)")
	}
	c.Exclude = append([]string(nil), c.Exclude...)
	sort.Strings(c.Exclude)
	for _, pattern := range c.Exclude {
		if _, err := path.Match(strings.ReplaceAll(pattern, "**", "*"), ""); err != nil {
			return nil, fmt.Errorf("exclude pattern %q: %w", pattern, err)
		}
	}
	if err := os.MkdirAll(filepath.Join(c.IndexRoot, "generations"), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(c.IndexRoot, "metadata.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS generations(generation TEXT PRIMARY KEY,repository TEXT NOT NULL,revision TEXT NOT NULL,sv_ref TEXT NOT NULL,config TEXT NOT NULL,indexed INTEGER NOT NULL,omitted INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS current(id INTEGER PRIMARY KEY CHECK(id=1),generation TEXT NOT NULL REFERENCES generations(generation));
CREATE TABLE IF NOT EXISTS files(generation TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,permissions TEXT NOT NULL,PRIMARY KEY(generation,path));
CREATE TABLE IF NOT EXISTS omissions(generation TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,permissions TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(generation,path));`)
	if err != nil {
		db.Close()
		return nil, err
	}
	encoded, _ := json.Marshal(struct {
		Repository   string
		Exclude      []string
		MaxFileBytes int
	}{c.RepositoryID, c.Exclude, c.MaxFileBytes})
	sum := sha256.Sum256(encoded)
	return &Adapter{config: c, db: db, fingerprint: hex.EncodeToString(sum[:]), searchers: map[string]zoekt.Streamer{}}, nil
}

func (a *Adapter) status(ctx context.Context) (Snapshot, string, error) {
	var s Snapshot
	var fingerprint string
	err := a.db.QueryRowContext(ctx, `SELECT g.generation,g.repository,g.revision,g.sv_ref,g.indexed,g.omitted,g.config FROM generations g JOIN current c ON c.generation=g.generation WHERE c.id=1`).Scan(&s.Generation, &s.RepositoryID, &s.Revision, &s.SVRef, &s.IndexedFiles, &s.OmittedFiles, &fingerprint)
	if errors.Is(err, sql.ErrNoRows) {
		return s, "", ErrNotIndexed
	}
	if err != nil {
		return s, "", err
	}
	if s.RepositoryID != a.config.RepositoryID {
		return s, "", errors.New("published repository ID mismatch")
	}
	return s, fingerprint, nil
}
func (a *Adapter) Status(ctx context.Context) (Snapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return Snapshot{}, errors.New("adapter closed")
	}
	s, _, err := a.status(ctx)
	if err == nil {
		a.retireSearchers(s.Generation)
	}
	return s, err
}
func (a *Adapter) Close() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return nil
	}
	a.closed = true
	for _, s := range a.searchers {
		s.Close()
	}
	return a.db.Close()
}

func (a *Adapter) retireSearchers(current string) {
	for generation, searcher := range a.searchers {
		if generation != current {
			searcher.Close()
			delete(a.searchers, generation)
		}
	}
}

func (a *Adapter) rows(ctx context.Context, generation string) (map[string]fileRow, error) {
	r, err := a.db.QueryContext(ctx, `SELECT path,hash,permissions,'' FROM files WHERE generation=? UNION ALL SELECT path,hash,permissions,reason FROM omissions WHERE generation=?`, generation, generation)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := map[string]fileRow{}
	for r.Next() {
		var f fileRow
		if err := r.Scan(&f.path, &f.hash, &f.permissions, &f.reason); err != nil {
			return nil, err
		}
		out[f.path] = f
	}
	return out, r.Err()
}

func copyShards(ctx context.Context, from, to string) error {
	entries, err := os.ReadDir(from)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() {
			return errors.New("unexpected non-regular generation entry")
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("non-regular shard")
		}
		if err := copyFile(filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}
func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func (a *Adapter) omitted(f fossil.File) string {
	if f.Permissions == "l" {
		return "symlink"
	}
	for _, pattern := range a.config.Exclude {
		if strings.HasSuffix(pattern, "/**") && strings.HasPrefix(f.Path, strings.TrimSuffix(pattern, "**")) {
			return "excluded"
		}
		if match, _ := path.Match(pattern, f.Path); match {
			return "excluded"
		}
	}
	return ""
}
func (a *Adapter) readBatch(ctx context.Context, hashes []string) (map[string][]byte, error) {
	data, err := a.config.Provider.ReadArtifacts(ctx, hashes)
	if errors.Is(err, fossil.ErrOutputLimit) && len(hashes) > 1 {
		mid := len(hashes) / 2
		left, err := a.readBatch(ctx, hashes[:mid])
		if err != nil {
			return nil, err
		}
		right, err := a.readBatch(ctx, hashes[mid:])
		if err != nil {
			return nil, err
		}
		for k, v := range right {
			left[k] = v
		}
		return left, nil
	}
	return data, err
}

func (a *Adapter) Index(ctx context.Context, revision fossil.Revision, mode string) (Snapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return Snapshot{}, errors.New("adapter closed")
	}
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if a.config.Provider == nil {
		return Snapshot{}, errors.New("Index requires a Fossil provider")
	}
	if mode != "full" && mode != "delta" {
		return Snapshot{}, errors.New("index mode must be full or delta")
	}
	previous, fingerprint, err := a.status(ctx)
	if err != nil && !errors.Is(err, ErrNotIndexed) {
		return Snapshot{}, err
	}
	if mode == "delta" && errors.Is(err, ErrNotIndexed) {
		return Snapshot{}, ErrNotIndexed
	}
	if mode == "delta" && fingerprint != a.fingerprint {
		return Snapshot{}, ErrConfigMismatch
	}
	revision, err = a.config.Provider.Revision(ctx, revision.Hash)
	if err != nil {
		return Snapshot{}, err
	}
	files, err := a.config.Provider.ListFiles(ctx, revision.Hash)
	if err != nil {
		return Snapshot{}, err
	}
	old := map[string]fileRow{}
	if mode == "delta" {
		old, err = a.rows(ctx, previous.Generation)
		if err != nil {
			return Snapshot{}, err
		}
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Snapshot{}, err
	}
	generation := hex.EncodeToString(random[:])
	dir := filepath.Join(a.config.IndexRoot, "generations", generation)
	if err := os.Mkdir(dir, 0700); err != nil {
		return Snapshot{}, err
	}
	if mode == "delta" {
		if err := copyShards(ctx, filepath.Join(a.config.IndexRoot, "generations", previous.Generation), dir); err != nil {
			return Snapshot{}, err
		}
	}
	opt := index.Options{IndexDir: dir, SizeMax: a.config.MaxFileBytes, TrigramMax: 1 << 30, Parallelism: 1, DisableCTags: true, IsDelta: mode == "delta", RepositoryDescription: zoekt.Repository{ID: 1, Name: a.config.RepositoryID, Branches: []zoekt.RepositoryBranch{{Name: "snapshot", Version: revision.Hash}}}}
	builder, err := index.NewBuilder(opt)
	if err != nil {
		return Snapshot{}, err
	}
	defer builder.Finish()
	current := map[string]fossil.File{}
	for _, f := range files {
		current[f.Path] = f
	}
	if mode == "delta" {
		for name, prior := range old {
			f, ok := current[name]
			if !ok || f.Hash != prior.hash || f.Permissions != prior.permissions {
				builder.MarkFileAsChangedOrRemoved(name)
			}
		}
	}
	snapshot := Snapshot{Generation: generation, RepositoryID: a.config.RepositoryID, Revision: revision.Hash, SVRef: svRef(revision.Comment)}
	all := make([]fileRow, 0, len(files))
	pending := make([]fossil.File, 0)
	for _, f := range files {
		prior, ok := old[f.Path]
		if mode == "delta" && ok && prior.hash == f.Hash && prior.permissions == f.Permissions {
			all = append(all, prior)
			continue
		}
		row := fileRow{path: f.Path, hash: f.Hash, permissions: f.Permissions, reason: a.omitted(f)}
		if row.reason != "" {
			all = append(all, row)
			continue
		}
		pending = append(pending, f)
	}
	for start := 0; start < len(pending); start += 64 {
		if err := ctx.Err(); err != nil {
			return Snapshot{}, err
		}
		end := min(start+64, len(pending))
		hashes := make([]string, 0, end-start)
		for _, f := range pending[start:end] {
			hashes = append(hashes, f.Hash)
		}
		data, err := a.readBatch(ctx, hashes)
		if err != nil {
			return Snapshot{}, err
		}
		for _, f := range pending[start:end] {
			content, ok := data[f.Hash]
			if !ok {
				return Snapshot{}, fmt.Errorf("artifact missing from bulk read: %s", f.Hash)
			}
			row := fileRow{path: f.Path, hash: f.Hash, permissions: f.Permissions}
			switch {
			case len(content) > a.config.MaxFileBytes:
				row.reason = "size"
			case bytes.IndexByte(content, 0) >= 0:
				row.reason = "binary"
			case !utf8.Valid(content):
				row.reason = "invalid-utf8"
			}
			all = append(all, row)
			if row.reason != "" {
				continue
			}
			if err := ctx.Err(); err != nil {
				return Snapshot{}, err
			}
			if err := builder.Add(index.Document{Name: f.Path, Content: content, Branches: []string{"snapshot"}}); err != nil {
				return Snapshot{}, err
			}
		}
	}
	if err := builder.Finish(); err != nil {
		return Snapshot{}, err
	}
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	for _, f := range all {
		if f.reason == "" {
			snapshot.IndexedFiles++
		} else {
			snapshot.OmittedFiles++
		}
	}
	searcher, err := zoektsearch.NewDirectorySearcher(dir)
	if err != nil {
		return Snapshot{}, err
	}
	if err := a.publish(ctx, previous.Generation, snapshot, all); err != nil {
		searcher.Close()
		return Snapshot{}, err
	}
	a.searchers[generation] = searcher
	a.retireSearchers(generation)
	return snapshot, nil
}

func svRef(comment string) string {
	match := regexp.MustCompile(`\bsv:([0-9a-f]{32})\b`).FindStringSubmatch(comment)
	if len(match) != 2 {
		return ""
	}
	return match[1]
}

func (a *Adapter) publish(ctx context.Context, expected string, s Snapshot, files []fileRow) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO generations VALUES(?,?,?,?,?,?,?)`, s.Generation, s.RepositoryID, s.Revision, s.SVRef, a.fingerprint, s.IndexedFiles, s.OmittedFiles); err != nil {
		return err
	}
	for _, f := range files {
		if f.reason == "" {
			_, err = tx.ExecContext(ctx, `INSERT INTO files VALUES(?,?,?,?)`, s.Generation, f.path, f.hash, f.permissions)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO omissions VALUES(?,?,?,?,?)`, s.Generation, f.path, f.hash, f.permissions, f.reason)
		}
		if err != nil {
			return err
		}
	}
	if expected == "" {
		_, err = tx.ExecContext(ctx, `INSERT INTO current VALUES(1,?)`, s.Generation)
	} else {
		var result sql.Result
		result, err = tx.ExecContext(ctx, `UPDATE current SET generation=? WHERE id=1 AND generation=?`, s.Generation, expected)
		if err == nil {
			n, e := result.RowsAffected()
			if e != nil {
				return e
			}
			if n != 1 {
				return ErrPublicationConflict
			}
		}
	}
	if err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return tx.Commit()
}

func (a *Adapter) Search(ctx context.Context, request Request) (Response, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := Response{Results: []Match{}}
	if a.closed {
		return out, errors.New("adapter closed")
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if request.Query == "" || len(request.Query) > a.config.MaxQueryBytes {
		return out, errors.New("query must be nonempty and within MaxQueryBytes")
	}
	limit := request.Limit
	if limit == 0 {
		limit = a.config.MaxResults
	}
	if limit < 1 || limit > a.config.MaxResults {
		return out, errors.New("query limit outside configured bounds")
	}
	var q query.Q
	switch request.Kind {
	case "code", "symbol_text":
		q = &query.Substring{Pattern: request.Query, Content: true, CaseSensitive: true}
	case "filename":
		q = &query.Substring{Pattern: request.Query, FileName: true, CaseSensitive: true}
	case "regex":
		r, err := syntax.Parse(request.Query, syntax.Perl)
		if err != nil {
			return out, err
		}
		q = &query.Regexp{Regexp: r, Content: true, CaseSensitive: true}
	default:
		return out, errors.New("kind must be code, regex, filename or symbol_text")
	}
	s, _, err := a.status(ctx)
	if err != nil {
		return out, err
	}
	out.Snapshot = s
	searcher := a.searchers[s.Generation]
	if searcher == nil {
		searcher, err = zoektsearch.NewDirectorySearcher(filepath.Join(a.config.IndexRoot, "generations", s.Generation))
		if err != nil {
			return out, err
		}
		a.searchers[s.Generation] = searcher
	}
	a.retireSearchers(s.Generation)
	ctx, cancel := context.WithTimeout(ctx, a.config.QueryTimeout)
	defer cancel()
	r, err := searcher.Search(ctx, q, &zoekt.SearchOptions{ShardMaxMatchCount: limit + 1, TotalMaxMatchCount: limit + 1, MaxDocDisplayCount: limit + 1, MaxMatchDisplayCount: limit + 1, MaxWallTime: a.config.QueryTimeout})
	if err != nil {
		return out, err
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	out.Stats = r.Stats
	out.Truncated = r.FilesSkipped > 0 || r.ShardsSkipped > 0 || r.Crashes > 0 || r.MatchCount > limit
	out.Complete = !out.Truncated
	header, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	used := len(header)
	if used > a.config.MaxResponseBytes {
		return out, fmt.Errorf("response metadata exceeds MaxResponseBytes: %d > %d", used, a.config.MaxResponseBytes)
	}
	for _, file := range r.Files {
		if file.Version != s.Revision {
			return out, errors.New("shard revision does not match published revision")
		}
		var hash string
		if err := a.db.QueryRowContext(ctx, `SELECT hash FROM files WHERE generation=? AND path=?`, s.Generation, file.FileName).Scan(&hash); err != nil {
			return out, err
		}
		for _, line := range file.LineMatches {
			m := Match{Generation: s.Generation, RepositoryID: s.RepositoryID, Revision: s.Revision, SVRef: s.SVRef, Path: file.FileName, ArtifactHash: hash, Line: line.LineNumber, Content: string(line.Line)}
			encoded, err := json.Marshal(m)
			if err != nil {
				return out, err
			}
			size := len(encoded)
			if len(out.Results) > 0 {
				size++
			}
			if len(out.Results) >= limit || size > a.config.MaxResponseBytes-used {
				out.Truncated = true
				out.Complete = false
				continue
			}
			used += size
			out.Results = append(out.Results, m)
		}
	}
	sort.Slice(out.Results, func(i, j int) bool {
		if out.Results[i].Path == out.Results[j].Path {
			return out.Results[i].Line < out.Results[j].Line
		}
		return out.Results[i].Path < out.Results[j].Path
	})
	encoded, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	if len(encoded) > a.config.MaxResponseBytes {
		return out, fmt.Errorf("response exceeds MaxResponseBytes: %d > %d", len(encoded), a.config.MaxResponseBytes)
	}
	return out, nil
}
