package bundle

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ManifestName is the manifest's file name at the bundle root; it never lists itself.
const ManifestName = "MANIFEST.sha256"

// Verification difference kinds.
const (
	DiffChanged = "changed"
	DiffMissing = "missing"
	DiffExtra   = "extra"
)

// Entry is one file: slash-separated path relative to the bundle root, size in bytes, lowercase hex sha256.
type Entry struct {
	Path   string
	Size   int64
	SHA256 string
}

// Manifest lists every file of a bundle, sorted by path.
type Manifest struct {
	Entries []Entry
}

// Diff is one verification finding.
type Diff struct {
	Path string
	Kind string
}

func (d Diff) String() string { return d.Kind + " " + d.Path }

// BuildManifest hashes every file under root, except the manifest itself at the root.
func BuildManifest(root string) (Manifest, error) {
	var m Manifest
	err := walkFiles(root, func(rel, p string) error {
		e, err := hashFile(p)
		if err != nil {
			return err
		}
		e.Path = rel
		m.Entries = append(m.Entries, e)
		return nil
	})
	sort.Slice(m.Entries, func(i, j int) bool { return m.Entries[i].Path < m.Entries[j].Path })
	return m, err
}

// walkFiles calls fn with the slash-separated relative path and the OS path of every file but the root manifest.
func walkFiles(root string, fn func(rel, p string) error) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		if rel = filepath.ToSlash(rel); rel == ManifestName {
			return nil
		}
		return fn(rel, p)
	})
}

func hashFile(p string) (Entry, error) {
	f, err := os.Open(p)
	if err != nil {
		return Entry{}, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return Entry{Size: n, SHA256: hex.EncodeToString(h.Sum(nil))}, err
}

// Write prints one line per entry: "<sha256>  <size>  <path>".
func (m Manifest) Write(w io.Writer) error {
	bw := bufio.NewWriter(w)
	for _, e := range m.Entries {
		if _, err := fmt.Fprintf(bw, "%s  %d  %s\n", e.SHA256, e.Size, e.Path); err != nil {
			return err
		}
	}
	return bw.Flush()
}

var manifestLine = regexp.MustCompile(`^([0-9a-f]{64})  ([0-9]+)  (\S.*)$`)

// ParseManifest reads what Write printed and refuses anything else, including a path that leaves the root.
func ParseManifest(r io.Reader) (Manifest, error) {
	var m Manifest
	sc := bufio.NewScanner(r)
	for n := 1; sc.Scan(); n++ {
		g := manifestLine.FindStringSubmatch(sc.Text())
		if g == nil {
			return Manifest{}, fmt.Errorf("manifest line %d: malformed", n)
		}
		size, err := strconv.ParseInt(g[2], 10, 64)
		if err != nil {
			return Manifest{}, fmt.Errorf("manifest line %d: size: %w", n, err)
		}
		if p := g[3]; path.IsAbs(p) || path.Clean(p) != p || p == ".." || strings.HasPrefix(p, "../") || strings.Contains(p, `\`) {
			return Manifest{}, fmt.Errorf("manifest line %d: path %q is not a clean relative path", n, p)
		}
		m.Entries = append(m.Entries, Entry{Path: g[3], Size: size, SHA256: g[1]})
	}
	return m, sc.Err()
}

// Verify compares root against the manifest: every listed file must exist with its size and hash, and nothing
// unlisted may be present. Diffs are sorted by path.
func (m Manifest) Verify(root string) ([]Diff, error) {
	want := make(map[string]Entry, len(m.Entries))
	for _, e := range m.Entries {
		want[e.Path] = e
	}
	var diffs []Diff
	err := walkFiles(root, func(rel, p string) error {
		e, listed := want[rel]
		if !listed {
			diffs = append(diffs, Diff{rel, DiffExtra})
			return nil
		}
		delete(want, rel)
		got, err := hashFile(p)
		if err != nil {
			return err
		}
		if got.Size != e.Size || got.SHA256 != e.SHA256 {
			diffs = append(diffs, Diff{rel, DiffChanged})
		}
		return nil
	})
	for p := range want {
		diffs = append(diffs, Diff{p, DiffMissing})
	}
	sort.Slice(diffs, func(i, j int) bool { return diffs[i].Path < diffs[j].Path })
	return diffs, err
}
