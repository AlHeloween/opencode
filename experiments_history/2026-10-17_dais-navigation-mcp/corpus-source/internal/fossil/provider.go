// Package fossil reads revision-pinned repository trees through Fossil's SQL API.
package fossil

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha3"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrOutputLimit = errors.New("Fossil command output limit exceeded")
	ErrNotFound    = errors.New("Fossil revision or path not found")
	fullHash       = regexp.MustCompile(`^(?:[a-f0-9]{40}|[a-f0-9]{64})$`)
)

// Config contains only caller-owned locations. New never creates these paths.
type Config struct {
	Executable     string
	Repository     string
	HeadRef        string
	FossilHome     string
	Timeout        time.Duration
	MaxOutputBytes int64
}

type Provider struct{ config Config }

type Revision struct {
	Hash    string `json:"hash"`
	Comment string `json:"comment"`
}

type File struct {
	Path         string `json:"path"`
	Hash         string `json:"hash"`
	PreviousPath string `json:"previous_path"`
	Permissions  string `json:"permissions"`
}

type ChangeKind string

const (
	Added    ChangeKind = "added"
	Modified ChangeKind = "modified"
	Deleted  ChangeKind = "deleted"
)

type Change struct {
	Kind   ChangeKind
	Path   string
	Before *File
	After  *File
}

func New(config Config) (*Provider, error) {
	if config.Executable == "" || config.Repository == "" || config.FossilHome == "" || config.HeadRef == "" {
		return nil, errors.New("Fossil executable, repository, home and head ref are required")
	}
	if config.Timeout <= 0 || config.MaxOutputBytes <= 0 {
		return nil, errors.New("positive Fossil timeout and output bounds are required")
	}
	executable, err := exec.LookPath(config.Executable)
	if err != nil {
		return nil, fmt.Errorf("Fossil executable: %w", err)
	}
	config.Executable, err = filepath.Abs(executable)
	if err != nil {
		return nil, err
	}
	if !filepath.IsAbs(config.Repository) || !filepath.IsAbs(config.FossilHome) {
		return nil, errors.New("Fossil repository and home must be absolute paths")
	}
	stat, err := os.Stat(config.Repository)
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() {
		return nil, errors.New("Fossil repository must be a regular file")
	}
	stat, err = os.Stat(config.FossilHome)
	if err != nil {
		return nil, err
	}
	if !stat.IsDir() {
		return nil, errors.New("Fossil home must be a caller-owned directory")
	}
	return &Provider{config: config}, nil
}

func quote(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

func (p *Provider) Head(ctx context.Context) (Revision, error) {
	var rows []Revision
	err := p.query(ctx, "SELECT b.uuid AS hash,COALESCE(e.comment,'') AS comment FROM blob b JOIN event e ON e.objid=b.rid WHERE e.type='ci' AND b.size>=0 AND b.rid=symbolic_name_to_rid("+quote(p.config.HeadRef)+")", &rows)
	if err != nil {
		return Revision{}, err
	}
	if len(rows) != 1 || !fullHash.MatchString(rows[0].Hash) {
		return Revision{}, fmt.Errorf("head %q: %w", p.config.HeadRef, ErrNotFound)
	}
	return rows[0], nil
}

// Revision resolves canonical metadata for an immutable full check-in hash.
func (p *Provider) Revision(ctx context.Context, revision string) (Revision, error) {
	if !fullHash.MatchString(revision) {
		return Revision{}, fmt.Errorf("revision must be a full lowercase 40- or 64-character hash")
	}
	var rows []Revision
	if err := p.query(ctx, "SELECT b.uuid AS hash,COALESCE(e.comment,'') AS comment FROM blob b JOIN event e ON e.objid=b.rid WHERE e.type='ci' AND b.size>=0 AND b.uuid="+quote(revision), &rows); err != nil {
		return Revision{}, err
	}
	if len(rows) != 1 || rows[0].Hash != revision {
		return Revision{}, fmt.Errorf("revision %s: %w", revision, ErrNotFound)
	}
	return rows[0], nil
}

func (p *Provider) validateRevision(ctx context.Context, revision string) error {
	_, err := p.Revision(ctx, revision)
	return err
}

func (p *Provider) ListFiles(ctx context.Context, revision string) ([]File, error) {
	if err := p.validateRevision(ctx, revision); err != nil {
		return nil, err
	}
	var rows []File
	if err := p.query(ctx, "SELECT filename AS path,uuid AS hash,COALESCE(previousName,'') AS previous_path,COALESCE(perm,'') AS permissions FROM files_of_checkin("+quote(revision)+") ORDER BY filename", &rows); err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(rows))
	for _, file := range rows {
		if !validPath(file.Path) || !fullHash.MatchString(file.Hash) || seen[file.Path] {
			return nil, fmt.Errorf("invalid manifest file %q", file.Path)
		}
		seen[file.Path] = true
	}
	return rows, nil
}

func validPath(name string) bool {
	return name != "" && name != "." && !strings.ContainsAny(name, "\\\x00:") && !strings.HasPrefix(name, "/") && path.Clean(name) == name && name != ".." && !strings.HasPrefix(name, "../")
}

func (p *Provider) ReadFile(ctx context.Context, revision, name string) ([]byte, error) {
	if !validPath(name) {
		return nil, fmt.Errorf("invalid repository path %q", name)
	}
	files, err := p.ListFiles(ctx, revision)
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		if file.Path == name {
			return p.readArtifact(ctx, file.Hash)
		}
	}
	return nil, fmt.Errorf("path %q at %s: %w", name, revision, ErrNotFound)
}

func (p *Provider) readArtifact(ctx context.Context, hash string) ([]byte, error) {
	artifacts, err := p.ReadArtifacts(ctx, []string{hash})
	if err != nil {
		return nil, err
	}
	return artifacts[hash], nil
}

type artifactRow struct {
	Hash    string `json:"hash"`
	Size    int64  `json:"size"`
	Content string `json:"content"`
}

// ReadArtifacts retrieves a caller-bounded batch of immutable artifact contents.
// Hashes may repeat. Missing or phantom artifacts invalidate the whole batch.
func (p *Provider) ReadArtifacts(ctx context.Context, hashes []string) (map[string][]byte, error) {
	artifacts := make(map[string][]byte, len(hashes))
	if len(hashes) == 0 {
		return artifacts, nil
	}
	requested := make(map[string]bool, len(hashes))
	quoted := make([]string, 0, len(hashes))
	for _, hash := range hashes {
		if !fullHash.MatchString(hash) {
			return nil, errors.New("artifact must be a full lowercase 40- or 64-character hash")
		}
		if !requested[hash] {
			requested[hash] = true
			quoted = append(quoted, quote(hash))
		}
	}
	var rows []artifactRow
	if err := p.query(ctx, "SELECT uuid AS hash,size,hex(content(uuid)) AS content FROM blob WHERE size>=0 AND uuid IN ("+strings.Join(quoted, ",")+") ORDER BY uuid", &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		if !requested[row.Hash] {
			return nil, fmt.Errorf("unexpected artifact %s", row.Hash)
		}
		if _, exists := artifacts[row.Hash]; exists {
			return nil, fmt.Errorf("duplicate artifact %s", row.Hash)
		}
		data, err := decodeArtifact(row)
		if err != nil {
			return nil, err
		}
		artifacts[row.Hash] = data
	}
	for _, hash := range hashes {
		if _, exists := artifacts[hash]; !exists {
			return nil, fmt.Errorf("artifact %s: %w", hash, ErrNotFound)
		}
	}
	return artifacts, nil
}

func decodeArtifact(row artifactRow) ([]byte, error) {
	data, err := hex.DecodeString(row.Content)
	if err != nil {
		return nil, fmt.Errorf("artifact hex: %w", err)
	}
	if int64(len(data)) != row.Size {
		return nil, fmt.Errorf("artifact %s length mismatch", row.Hash)
	}
	var actual string
	if len(row.Hash) == 40 {
		sum := sha1.Sum(data)
		actual = hex.EncodeToString(sum[:])
	} else {
		sum := sha3.Sum256(data)
		actual = hex.EncodeToString(sum[:])
	}
	if actual != row.Hash {
		return nil, fmt.Errorf("artifact %s content hash mismatch", row.Hash)
	}
	return data, nil
}

func (p *Provider) Changes(ctx context.Context, from, to string) ([]Change, error) {
	before, err := p.ListFiles(ctx, from)
	if err != nil {
		return nil, err
	}
	after, err := p.ListFiles(ctx, to)
	if err != nil {
		return nil, err
	}
	old := make(map[string]File, len(before))
	next := make(map[string]File, len(after))
	names := make(map[string]bool, len(before)+len(after))
	for _, file := range before {
		old[file.Path] = file
		names[file.Path] = true
	}
	for _, file := range after {
		next[file.Path] = file
		names[file.Path] = true
	}
	ordered := make([]string, 0, len(names))
	for name := range names {
		ordered = append(ordered, name)
	}
	sort.Strings(ordered)
	changes := make([]Change, 0)
	for _, name := range ordered {
		a, hasA := old[name]
		b, hasB := next[name]
		switch {
		case !hasA:
			changes = append(changes, Change{Kind: Added, Path: name, After: &b})
		case !hasB:
			changes = append(changes, Change{Kind: Deleted, Path: name, Before: &a})
		case a.Hash != b.Hash || a.Permissions != b.Permissions:
			changes = append(changes, Change{Kind: Modified, Path: name, Before: &a, After: &b})
		}
	}
	return changes, nil
}

type outputBound struct {
	mu        sync.Mutex
	remaining int64
	exceeded  bool
	cancel    context.CancelFunc
}
type boundedWriter struct {
	bound  *outputBound
	buffer *bytes.Buffer
}

func (w boundedWriter) Write(data []byte) (int, error) {
	w.bound.mu.Lock()
	defer w.bound.mu.Unlock()
	if int64(len(data)) > w.bound.remaining {
		w.bound.exceeded = true
		w.bound.cancel()
		return 0, ErrOutputLimit
	}
	w.bound.remaining -= int64(len(data))
	return w.buffer.Write(data)
}

func (p *Provider) query(ctx context.Context, sql string, destination any) error {
	ctx, cancel := context.WithTimeout(ctx, p.config.Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, p.config.Executable, "sql", "--no-repository", "--readonly", "-json", p.config.Repository, sql)
	cmd.Dir = p.config.FossilHome
	cmd.Env = make([]string, 0, len(os.Environ())+1)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !strings.EqualFold(key, "FOSSIL_HOME") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "FOSSIL_HOME="+p.config.FossilHome)
	cmd.Stdin = strings.NewReader("")
	cmd.WaitDelay = 2 * time.Second
	var stdout, stderr bytes.Buffer
	bound := &outputBound{remaining: p.config.MaxOutputBytes, cancel: cancel}
	cmd.Stdout = boundedWriter{bound, &stdout}
	cmd.Stderr = boundedWriter{bound, &stderr}
	err := cmd.Run()
	if bound.exceeded {
		return ErrOutputLimit
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("Fossil SQL: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	if strings.TrimSpace(stderr.String()) != "" {
		return fmt.Errorf("Fossil SQL diagnostic: %s", strings.TrimSpace(stderr.String()))
	}
	if len(bytes.TrimSpace(stdout.Bytes())) == 0 {
		return json.Unmarshal([]byte("[]"), destination)
	}
	decoder := json.NewDecoder(&stdout)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("Fossil SQL JSON: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected trailing Fossil SQL output")
	}
	return nil
}
