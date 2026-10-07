package bundle

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Component is one part of the bundle, copied by an explicit list: anything unnamed never reaches the bundle.
type Component struct {
	Name  string
	From  string   // source directory
	To    string   // slash-separated destination under the bundle root
	Files []string // files directly copied, relative to From
	Dirs  []string // directories copied recursively, relative to From
	Skip  []string // slash-separated paths under From left out of a listed directory; each must match something
}

// Runtime litter a listed directory may carry: rewritten at run time (Python bytecode) or per-install state.
var litterDirs = map[string]bool{"__pycache__": true, ".opencode": true, "locks": true}

// Stage copies every component into out, which must be empty or absent (two builds never mix).
func Stage(components []Component, out string) error {
	if entries, err := os.ReadDir(out); err == nil && len(entries) > 0 {
		return fmt.Errorf("stage: %s is not empty", out)
	}
	for _, c := range components {
		if err := stageOne(c, out); err != nil {
			return fmt.Errorf("stage %s: %w", c.Name, err)
		}
	}
	return nil
}

func stageOne(c Component, out string) error {
	dest := filepath.Join(out, filepath.FromSlash(c.To))
	for _, f := range c.Files {
		if err := copyFile(filepath.Join(c.From, filepath.FromSlash(f)), filepath.Join(dest, filepath.FromSlash(f))); err != nil {
			return fmt.Errorf("listed file %s: %w", f, err)
		}
	}
	skip := map[string]bool{}
	for _, s := range c.Skip {
		skip[s] = false
	}
	for _, d := range c.Dirs {
		root := filepath.Join(c.From, filepath.FromSlash(d))
		if _, err := os.Stat(root); err != nil {
			return fmt.Errorf("listed directory %s: %w", d, err)
		}
		err := filepath.WalkDir(root, func(p string, e fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(c.From, p)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			if _, listed := skip[rel]; listed {
				skip[rel] = true
				if e.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if e.IsDir() {
				if litterDirs[e.Name()] {
					return filepath.SkipDir
				}
				return nil
			}
			if path.Ext(e.Name()) == ".pyc" {
				return nil
			}
			return copyFile(p, filepath.Join(dest, filepath.FromSlash(rel)))
		})
		if err != nil {
			return err
		}
	}
	var unused []string
	for s, hit := range skip {
		if !hit {
			unused = append(unused, s)
		}
	}
	if len(unused) > 0 {
		return fmt.Errorf("skip entries matched nothing: %s", strings.Join(unused, ", "))
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	o, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(o, in); err != nil {
		o.Close()
		return err
	}
	return o.Close()
}
