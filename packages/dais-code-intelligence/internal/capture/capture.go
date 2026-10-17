package capture

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"dais.local/codeintelligence/internal/fossil"
)

type Config struct {
	Provider                                                           *fossil.Provider
	SourceRevision, Indexer, IndexerSHA256                             string
	Args, Environment                                                  []string
	ScratchRoot, BundleDirectory, IndexPath, ManifestPath, ReceiptPath string
	MaxFiles                                                           int
	MaxSourceBytes, MaxFileBytes, MaxIndexBytes, MaxLogBytes           int64
	Timeout                                                            time.Duration
}

type Input struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type Indexer struct {
	Path   string   `json:"path"`
	SHA256 string   `json:"sha256"`
	Args   []string `json:"args"`
}

type Receipt struct {
	Version           int      `json:"version"`
	SourceRevision    string   `json:"source_revision"`
	SourceInputs      []Input  `json:"source_inputs"`
	SourceInputDigest string   `json:"source_input_digest"`
	Indexer           Indexer  `json:"indexer"`
	Environment       []string `json:"environment"`
	IndexSHA256       string   `json:"index_sha256"`
	Result            string   `json:"result"`
	ExitCode          int      `json:"exit_code"`
	Stdout            string   `json:"stdout"`
	Stderr            string   `json:"stderr"`
	Diagnostics       string   `json:"diagnostics"`
	SemanticStatus    string   `json:"semantic_status"`
}

type Manifest struct {
	Version     int     `json:"version"`
	IndexSHA256 string  `json:"index_sha256"`
	Inputs      []Input `json:"inputs"`
}

var hexDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var environmentKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func hash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

func fileHash(name string) (string, error) {
	if err := regular(name); err != nil {
		return "", err
	}
	f, err := os.Open(name)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, readErr := io.Copy(h, f)
	if err := errors.Join(readErr, f.Close()); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func regular(name string) error {
	st, err := os.Lstat(name)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("not a regular nonsymlink file: %s", name)
	}
	return nil
}

func existingPath(name string, directory bool) error {
	if !filepath.IsAbs(name) || filepath.Clean(name) != name {
		return fmt.Errorf("absolute clean path required: %s", name)
	}
	for current := name; ; current = filepath.Dir(current) {
		st, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink path forbidden: %s", current)
		}
		if current == name && directory && !st.IsDir() {
			return fmt.Errorf("directory required: %s", name)
		}
		if filepath.Dir(current) == current {
			break
		}
	}
	return nil
}

func repositoryPath(name string) error {
	if name == "" || path.Clean(name) != name || name == "." || strings.HasPrefix(name, "/") || name == ".." || strings.HasPrefix(name, "../") || strings.ContainsAny(name, "\\<>:\"|?*\x00") {
		return fmt.Errorf("unsafe repository path %q", name)
	}
	for _, component := range strings.Split(name, "/") {
		if strings.TrimRight(component, ". ") != component {
			return fmt.Errorf("Windows alias path %q", name)
		}
		for _, r := range component {
			if r < 32 {
				return fmt.Errorf("control in path %q", name)
			}
		}
		stem := strings.ToUpper(strings.SplitN(component, ".", 2)[0])
		if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || stem == "CONIN$" || stem == "CONOUT$" {
			return fmt.Errorf("reserved Windows path %q", name)
		}
		if len([]rune(stem)) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && strings.ContainsRune("123456789¹²³", []rune(stem)[3]) {
			return fmt.Errorf("reserved Windows path %q", name)
		}
	}
	return nil
}

func overlaps(a, b string) bool {
	a = strings.ToUpper(a)
	b = strings.ToUpper(b)
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

func validate(c Config) ([]string, error) {
	if c.Provider == nil || c.SourceRevision == "" || c.Timeout <= 0 || c.MaxFiles <= 0 || c.MaxSourceBytes <= 0 || c.MaxFileBytes <= 0 || c.MaxIndexBytes <= 0 || c.MaxLogBytes <= 0 {
		return nil, errors.New("provider, pinned revision and positive capture bounds required")
	}
	if !hexDigest.MatchString(c.IndexerSHA256) {
		return nil, errors.New("expected lowercase SHA256 required")
	}
	if err := existingPath(c.Indexer, false); err != nil {
		return nil, err
	}
	if err := regular(c.Indexer); err != nil {
		return nil, err
	}
	if err := existingPath(c.ScratchRoot, true); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(c.BundleDirectory) || filepath.Clean(c.BundleDirectory) != c.BundleDirectory {
		return nil, errors.New("absolute clean bundle directory required")
	}
	if err := existingPath(filepath.Dir(c.BundleDirectory), true); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(c.BundleDirectory); !os.IsNotExist(err) {
		return nil, fmt.Errorf("bundle must not exist: %s (%v)", c.BundleDirectory, err)
	}
	paths := []string{c.IndexPath, c.ManifestPath, c.ReceiptPath}
	for i, p := range paths {
		if err := repositoryPath(p); err != nil {
			return nil, err
		}
		for _, other := range paths[:i] {
			if overlaps(p, other) {
				return nil, errors.New("output paths overlap or alias")
			}
		}
	}
	count := 0
	for _, arg := range c.Args {
		count += strings.Count(arg, "{index}")
		if strings.ContainsRune(arg, 0) {
			return nil, errors.New("NUL in argv")
		}
	}
	if count != 1 {
		return nil, errors.New("exactly one {index} output placeholder required")
	}
	if c.Environment == nil {
		return nil, errors.New("explicit environment allowlist required (empty is permitted)")
	}
	env := append([]string{}, c.Environment...)
	seen := map[string]bool{}
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || !environmentKey.MatchString(key) || strings.ContainsRune(value, 0) {
			return nil, errors.New("invalid explicit environment entry")
		}
		folded := strings.ToUpper(key)
		if seen[folded] {
			return nil, fmt.Errorf("duplicate/case-colliding environment key %s", key)
		}
		seen[folded] = true
	}
	if runtime.GOOS == "windows" && !seen["SYSTEMROOT"] {
		return nil, errors.New("explicit SYSTEMROOT entry required; Go would otherwise inherit it")
	}
	sort.Strings(env)
	return env, nil
}

// Run exports evidence of execution over declared immutable inputs. It is not a
// filesystem sandbox: external toolchain reads and descendant lifetime require
// producer qualification. CommandContext cancels the direct child only.
func Run(ctx context.Context, c Config) (receipt Receipt, err error) {
	receipt = Receipt{Version: 1, SourceRevision: c.SourceRevision, Result: "FAILED", ExitCode: -1, SemanticStatus: "unknown", SourceInputs: []Input{}}
	defer func() {
		if err != nil {
			receipt.Result = "FAILED"
			receipt.Diagnostics = err.Error()
		}
	}()
	ctx, captureCancel := context.WithTimeout(ctx, c.Timeout)
	defer captureCancel()
	if err := ctx.Err(); err != nil {
		return receipt, err
	}
	env, err := validate(c)
	if err != nil {
		return receipt, err
	}
	receipt.Environment = env
	actual, err := fileHash(c.Indexer)
	if err != nil {
		return receipt, err
	}
	if actual != c.IndexerSHA256 {
		return receipt, errors.New("indexer SHA256 does not match required pin")
	}
	receipt.Indexer = Indexer{Path: c.Indexer, SHA256: actual}
	files, err := c.Provider.ListFiles(ctx, c.SourceRevision)
	if err != nil {
		return receipt, err
	}
	if len(files) == 0 || len(files) > c.MaxFiles {
		return receipt, errors.New("source file count outside bounds")
	}
	seen := map[string]bool{}
	for _, file := range files {
		if err := repositoryPath(file.Path); err != nil {
			return receipt, err
		}
		if file.Permissions == "l" {
			return receipt, errors.New("tracked symlink forbidden")
		}
		key := strings.ToUpper(file.Path)
		if seen[key] {
			return receipt, fmt.Errorf("Windows source path alias: %s", file.Path)
		}
		seen[key] = true
		for _, out := range []string{c.IndexPath, c.ManifestPath, c.ReceiptPath} {
			if overlaps(file.Path, out) {
				return receipt, fmt.Errorf("source/output path collision: %s", file.Path)
			}
		}
	}
	for _, file := range files {
		parts := strings.Split(file.Path, "/")
		for i := 1; i < len(parts); i++ {
			if seen[strings.ToUpper(strings.Join(parts[:i], "/"))] {
				return receipt, errors.New("source file/directory prefix collision")
			}
		}
	}
	workspace, err := os.MkdirTemp(c.ScratchRoot, "dais-capture-")
	if err != nil {
		return receipt, err
	}
	defer func() {
		if workspace != "" {
			err = errors.Join(err, os.RemoveAll(workspace))
		}
	}()
	var total int64
	for start := 0; start < len(files); {
		end := min(start+64, len(files))
		var contents map[string][]byte
		for {
			hashes := make([]string, 0, end-start)
			for _, file := range files[start:end] {
				hashes = append(hashes, file.Hash)
			}
			contents, err = c.Provider.ReadArtifacts(ctx, hashes)
			if !errors.Is(err, fossil.ErrOutputLimit) || end-start <= 1 {
				break
			}
			end = start + (end-start)/2
		}
		if err != nil {
			return receipt, err
		}
		for _, file := range files[start:end] {
			data := contents[file.Hash]
			size := int64(len(data))
			if size > c.MaxFileBytes || size > c.MaxSourceBytes-total {
				return receipt, errors.New("source byte bound exceeded")
			}
			total += size
			name := filepath.Join(workspace, filepath.FromSlash(file.Path))
			if err := writeNew(name, data); err != nil {
				return receipt, err
			}
			receipt.SourceInputs = append(receipt.SourceInputs, Input{Path: file.Path, SHA256: hash(data)})
		}
		start = end
	}
	sort.Slice(receipt.SourceInputs, func(i, j int) bool { return receipt.SourceInputs[i].Path < receipt.SourceInputs[j].Path })
	encoded, err := json.Marshal(receipt.SourceInputs)
	if err != nil {
		return receipt, err
	}
	receipt.SourceInputDigest = hash(encoded)
	output := filepath.Join(workspace, filepath.FromSlash(c.IndexPath))
	for _, reserved := range []string{c.IndexPath, c.ManifestPath, c.ReceiptPath} {
		if _, err := os.Lstat(filepath.Join(workspace, filepath.FromSlash(reserved))); !os.IsNotExist(err) {
			return receipt, fmt.Errorf("reserved output aliases an existing workspace path: %s (%v)", reserved, err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
		return receipt, err
	}
	args := make([]string, len(c.Args))
	for i, arg := range c.Args {
		args[i] = strings.ReplaceAll(arg, "{index}", output)
	}
	receipt.Indexer.Args = args
	childCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(childCtx, c.Indexer, args...)
	cmd.Dir = workspace
	cmd.Env = env
	cmd.Stdin = strings.NewReader("")
	cmd.WaitDelay = time.Second
	bound := &logBound{remaining: c.MaxLogBytes, cancel: cancel}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = logWriter{bound: bound, buffer: &stdout}
	cmd.Stderr = logWriter{bound: bound, buffer: &stderr}
	beforeLaunch, err := fileHash(c.Indexer)
	if err != nil || beforeLaunch != actual {
		return receipt, errors.Join(errors.New("indexer changed before launch"), err)
	}
	runErr := cmd.Run()
	receipt.Stdout = stdout.String()
	receipt.Stderr = stderr.String()
	if cmd.ProcessState != nil {
		receipt.ExitCode = cmd.ProcessState.ExitCode()
	}
	after, hashErr := fileHash(c.Indexer)
	if hashErr != nil || after != actual {
		return receipt, errors.Join(errors.New("indexer changed during capture"), runErr, hashErr)
	}
	if bound.exceeded {
		return receipt, errors.Join(errors.New("combined stdout/stderr bound exceeded; capture incomplete"), runErr)
	}
	if childCtx.Err() != nil {
		return receipt, errors.Join(childCtx.Err(), runErr)
	}
	if runErr != nil {
		return receipt, fmt.Errorf("indexer execution: %w", runErr)
	}
	if !utf8.Valid(stdout.Bytes()) || !utf8.Valid(stderr.Bytes()) {
		return receipt, errors.New("producer diagnostics must be UTF-8 text")
	}
	if err := inspectWorkspace(workspace, c.IndexPath, receipt.SourceInputs, c.MaxFileBytes); err != nil {
		return receipt, err
	}
	if err := regular(output); err != nil {
		return receipt, err
	}
	index, err := readBounded(output, c.MaxIndexBytes)
	if err != nil {
		return receipt, err
	}
	if len(index) == 0 {
		return receipt, errors.New("index output is empty")
	}
	receipt.IndexSHA256 = hash(index)
	receipt.Result = "CAPTURED"
	if err := os.RemoveAll(workspace); err != nil {
		return receipt, fmt.Errorf("scratch cleanup: %w", err)
	}
	workspace = ""
	rawReceipt, err := json.Marshal(receipt)
	if err != nil {
		return receipt, err
	}
	manifest := Manifest{Version: 1, IndexSHA256: receipt.IndexSHA256, Inputs: append(append([]Input{}, receipt.SourceInputs...), Input{Path: c.ReceiptPath, SHA256: hash(rawReceipt)})}
	sort.Slice(manifest.Inputs, func(i, j int) bool { return manifest.Inputs[i].Path < manifest.Inputs[j].Path })
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		return receipt, err
	}
	stage, err := os.MkdirTemp(filepath.Dir(c.BundleDirectory), ".dais-bundle-")
	if err != nil {
		return receipt, err
	}
	defer func() { err = errors.Join(err, os.RemoveAll(stage)) }()
	for _, entry := range []struct {
		path string
		data []byte
	}{{c.IndexPath, index}, {c.ReceiptPath, rawReceipt}, {c.ManifestPath, rawManifest}} {
		if err := writeNew(filepath.Join(stage, filepath.FromSlash(entry.path)), entry.data); err != nil {
			return receipt, err
		}
	}
	if err := publish(ctx, stage, c.BundleDirectory); err != nil {
		return receipt, err
	}
	return receipt, nil
}

func publish(ctx context.Context, from, to string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return publishDirectory(from, to)
}

func writeNew(name string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	return errors.Join(writeErr, f.Close())
}

func readBounded(name string, maximum int64) ([]byte, error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		return nil, errors.Join(err, f.Close())
	}
	if !st.Mode().IsRegular() || st.Size() > maximum {
		return nil, errors.Join(errors.New("file outside regular/byte bounds"), f.Close())
	}
	data, readErr := io.ReadAll(io.LimitReader(f, maximum+1))
	if err := errors.Join(readErr, f.Close()); err != nil {
		return nil, err
	}
	if int64(len(data)) > maximum {
		return nil, errors.New("file byte bound exceeded")
	}
	return data, nil
}

func inspectWorkspace(root, index string, inputs []Input, maxBytes int64) error {
	want := make(map[string]string, len(inputs))
	for _, in := range inputs {
		want[in.Path] = in.SHA256
	}
	seen := map[string]bool{}
	err := filepath.WalkDir(root, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink generated by producer: %s", name)
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == index {
			return regular(name)
		}
		expected, ok := want[rel]
		if !ok {
			return fmt.Errorf("unexpected workspace file: %s", rel)
		}
		if err := regular(name); err != nil {
			return err
		}
		data, err := readBounded(name, maxBytes)
		if err != nil {
			return err
		}
		if hash(data) != expected {
			return fmt.Errorf("producer mutated source: %s", rel)
		}
		seen[rel] = true
		return nil
	})
	if err != nil {
		return err
	}
	if len(seen) != len(want) {
		return errors.New("producer deleted or renamed source")
	}
	return nil
}

type logBound struct {
	mu        sync.Mutex
	remaining int64
	exceeded  bool
	cancel    context.CancelFunc
}
type logWriter struct {
	bound  *logBound
	buffer *bytes.Buffer
}

func (w logWriter) Write(data []byte) (int, error) {
	w.bound.mu.Lock()
	defer w.bound.mu.Unlock()
	if int64(len(data)) > w.bound.remaining {
		w.bound.exceeded = true
		w.bound.cancel()
		return 0, errors.New("capture log bound exceeded")
	}
	w.bound.remaining -= int64(len(data))
	return w.buffer.Write(data)
}
