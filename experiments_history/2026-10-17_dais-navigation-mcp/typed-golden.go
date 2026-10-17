package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type pin struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
	Role   string `json:"role"`
}
type cohort struct {
	PackagePath       string   `json:"package_path"`
	Name              string   `json:"name"`
	GOOS              string   `json:"goos"`
	GOARCH            string   `json:"goarch"`
	GoFiles           []string `json:"go_files"`
	ExcludedTestFiles []string `json:"excluded_test_files"`
	IgnoredGoFiles    []string `json:"ignored_go_files"`
}
type definition struct {
	ID           string `json:"id"`
	PackagePath  string `json:"package_path"`
	Receiver     string `json:"receiver,omitempty"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	DocumentPath string `json:"document_path"`
	Range        [4]int `json:"range"`
}
type reference struct {
	DocumentPath string `json:"document_path"`
	Range        [4]int `json:"range"`
	TargetID     string `json:"target_id"`
}
type report struct {
	Version       int               `json:"version"`
	Status        string            `json:"status"`
	ModuleRoot    string            `json:"module_root"`
	GoExecutable  string            `json:"go_executable"`
	GoEnvironment map[string]string `json:"go_environment"`
	GoListArgs    []string          `json:"go_list_args"`
	Packages      []cohort          `json:"packages"`
	SourcePins    []pin             `json:"source_pins"`
	Definitions   []definition      `json:"definitions"`
	References    []reference       `json:"references"`
	Exclusions    []string          `json:"exclusions"`
	Errors        []string          `json:"errors"`
}
type listedPackage struct {
	ImportPath, Name, Dir, Export                                         string
	GoFiles, TestGoFiles, XTestGoFiles, IgnoredGoFiles, CgoFiles, Imports []string
	Module                                                                *struct{ GoVersion string }
}
type boundedBuffer struct {
	bytes.Buffer
	limit    int
	cancel   context.CancelFunc
	exceeded bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		b.exceeded = true
		b.cancel()
		return 0, errors.New("Go command output bound exceeded")
	}
	return b.Buffer.Write(p)
}
func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func command(goPath, root string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath, args...)
	cmd.Dir = root
	cmd.WaitDelay = time.Second
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "GOOS", "GOARCH", "GOWORK", "GOPROXY", "GOSUMDB":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "GOOS=windows", "GOARCH=amd64", "GOWORK=off", "GOPROXY=off", "GOSUMDB=off")
	out := &boundedBuffer{limit: 16 << 20, cancel: cancel}
	stderr := &boundedBuffer{limit: 1 << 20, cancel: cancel}
	cmd.Stdout = out
	cmd.Stderr = stderr
	err := cmd.Run()
	if out.exceeded || stderr.exceeded {
		return nil, errors.New("Go command exceeded stdout/stderr bound; inventory incomplete")
	}
	if err != nil {
		return nil, fmt.Errorf("go %v: %w\n%s", args, err, stderr.String())
	}
	return out.Bytes(), nil
}
func relative(root, name string) (string, error) {
	p, err := filepath.Rel(root, name)
	if err != nil || p == ".." || strings.HasPrefix(p, ".."+string(filepath.Separator)) || filepath.IsAbs(p) {
		return "", fmt.Errorf("source outside module: %s", name)
	}
	return filepath.ToSlash(p), nil
}
func sourcePin(root, name, role string) (pin, []byte, error) {
	rel, err := relative(root, name)
	if err != nil {
		return pin{}, nil, err
	}
	st, err := os.Lstat(name)
	if err != nil {
		return pin{}, nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > 16<<20 {
		return pin{}, nil, fmt.Errorf("source not bounded regular file: %s", name)
	}
	b, err := os.ReadFile(name)
	if err != nil {
		return pin{}, nil, err
	}
	return pin{Path: rel, SHA256: digest(b), Bytes: len(b), Role: role}, b, nil
}

type checker struct {
	fset     *token.FileSet
	packages map[string]listedPackage
	selected map[string]listedPackage
	checked  map[string]*types.Package
	infos    map[string]*types.Info
	loading  map[string]bool
	contents map[string][]byte
	external types.Importer
}

func (c *checker) Import(path string) (*types.Package, error) {
	if _, ok := c.selected[path]; ok {
		return c.check(path)
	}
	return c.external.Import(path)
}
func (c *checker) check(path string) (*types.Package, error) {
	if p := c.checked[path]; p != nil {
		return p, nil
	}
	if c.loading[path] {
		return nil, fmt.Errorf("own package import cycle: %s", path)
	}
	c.loading[path] = true
	defer delete(c.loading, path)
	p := c.selected[path]
	files := make([]*ast.File, 0, len(p.GoFiles))
	for _, name := range p.GoFiles {
		full := filepath.Join(p.Dir, name)
		f, err := parser.ParseFile(c.fset, full, c.contents[full], parser.AllErrors|parser.SkipObjectResolution)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	info := &types.Info{Defs: map[*ast.Ident]types.Object{}, Uses: map[*ast.Ident]types.Object{}, Selections: map[*ast.SelectorExpr]*types.Selection{}}
	config := types.Config{Importer: c, Sizes: types.SizesFor("gc", "amd64")}
	if p.Module != nil && p.Module.GoVersion != "" {
		config.GoVersion = "go" + p.Module.GoVersion
	}
	checked, err := config.Check(path, c.fset, files, info)
	if err != nil {
		return nil, fmt.Errorf("type check %s: %w", path, err)
	}
	c.checked[path] = checked
	c.infos[path] = info
	return checked, nil
}
func (c *checker) location(root string, ident *ast.Ident) (string, [4]int, error) {
	start, end := c.fset.PositionFor(ident.Pos(), false), c.fset.PositionFor(ident.End(), false)
	if !start.IsValid() || !end.IsValid() {
		return "", [4]int{}, errors.New("invalid identifier position")
	}
	path, err := relative(root, start.Filename)
	return path, [4]int{start.Line - 1, start.Column - 1, end.Line - 1, end.Column - 1}, err
}
func collect(r *report, c *checker) error {
	objects := map[types.Object]definition{}
	for pkg, info := range c.infos {
		for ident, obj := range info.Defs {
			fn, ok := obj.(*types.Func)
			if !ok || fn.Pkg() == nil {
				continue
			}
			path, position, err := c.location(r.ModuleRoot, ident)
			if err != nil {
				return err
			}
			d := definition{PackagePath: pkg, Name: fn.Name(), Kind: "function", DocumentPath: path, Range: position}
			if recv := fn.Type().(*types.Signature).Recv(); recv != nil {
				d.Kind = "method"
				d.Receiver = types.TypeString(recv.Type(), func(p *types.Package) string { return p.Path() })
			}
			encoded, err := json.Marshal(d)
			if err != nil {
				return err
			}
			d.ID = digest(encoded)
			objects[obj] = d
			r.Definitions = append(r.Definitions, d)
		}
	}
	refs := map[string]reference{}
	add := func(ident *ast.Ident, obj types.Object) error {
		d, ok := objects[obj]
		if !ok {
			return nil
		}
		path, position, err := c.location(r.ModuleRoot, ident)
		if err != nil {
			return err
		}
		ref := reference{DocumentPath: path, Range: position, TargetID: d.ID}
		key, err := json.Marshal(ref)
		if err != nil {
			return err
		}
		refs[string(key)] = ref
		return nil
	}
	for _, info := range c.infos {
		for ident, obj := range info.Uses {
			if err := add(ident, obj); err != nil {
				return err
			}
		}
		for selector, selection := range info.Selections {
			if err := add(selector.Sel, selection.Obj()); err != nil {
				return err
			}
		}
	}
	for _, ref := range refs {
		r.References = append(r.References, ref)
	}
	sort.Slice(r.Definitions, func(i, j int) bool {
		a, b := r.Definitions[i], r.Definitions[j]
		if a.DocumentPath != b.DocumentPath {
			return a.DocumentPath < b.DocumentPath
		}
		if a.Range != b.Range {
			for k := range a.Range {
				if a.Range[k] != b.Range[k] {
					return a.Range[k] < b.Range[k]
				}
			}
		}
		return a.ID < b.ID
	})
	sort.Slice(r.References, func(i, j int) bool {
		a, b := r.References[i], r.References[j]
		if a.DocumentPath != b.DocumentPath {
			return a.DocumentPath < b.DocumentPath
		}
		for k := range a.Range {
			if a.Range[k] != b.Range[k] {
				return a.Range[k] < b.Range[k]
			}
		}
		return a.TargetID < b.TargetID
	})
	return nil
}
func inventory(r *report) error {
	if !filepath.IsAbs(r.ModuleRoot) || filepath.Clean(r.ModuleRoot) != r.ModuleRoot || !filepath.IsAbs(r.GoExecutable) {
		return errors.New("absolute clean module root and absolute Go executable required")
	}
	before := map[string]pin{}
	for _, directory := range []string{"internal/fossil", "internal/capture"} {
		entries, err := os.ReadDir(filepath.Join(r.ModuleRoot, filepath.FromSlash(directory)))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".go") {
				continue
			}
			p, _, err := sourcePin(r.ModuleRoot, filepath.Join(r.ModuleRoot, filepath.FromSlash(directory), entry.Name()), "before-selection")
			if err != nil {
				return err
			}
			before[p.Path] = p
		}
	}
	for _, name := range []string{"go.mod", "go.sum"} {
		full := filepath.Join(r.ModuleRoot, name)
		if _, err := os.Stat(full); errors.Is(err, os.ErrNotExist) && name == "go.sum" {
			continue
		}
		p, _, err := sourcePin(r.ModuleRoot, full, "module")
		if err != nil {
			return err
		}
		before[p.Path] = p
	}
	if len(before) > 128 {
		return errors.New("pre-selection source file bound exceeded")
	}
	data, err := command(r.GoExecutable, r.ModuleRoot, "env", "-json", "GOVERSION", "GOROOT", "GOOS", "GOARCH", "GOWORK", "GOPROXY", "GOSUMDB", "GOFLAGS", "CGO_ENABLED", "GOAMD64", "GOTOOLCHAIN", "GOMOD", "GOEXPERIMENT")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &r.GoEnvironment); err != nil {
		return err
	}
	r.GoListArgs = []string{"list", "-mod=readonly", "-export", "-deps", "-json", "./internal/fossil", "./internal/capture"}
	data, err = command(r.GoExecutable, r.ModuleRoot, r.GoListArgs...)
	if err != nil {
		return err
	}
	c := &checker{fset: token.NewFileSet(), packages: map[string]listedPackage{}, selected: map[string]listedPackage{}, checked: map[string]*types.Package{}, infos: map[string]*types.Info{}, loading: map[string]bool{}, contents: map[string][]byte{}}
	decoder := json.NewDecoder(bytes.NewReader(data))
	for {
		var p listedPackage
		err := decoder.Decode(&p)
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		c.packages[p.ImportPath] = p
	}
	for _, dir := range []string{"fossil", "capture"} {
		found := 0
		for path, p := range c.packages {
			if filepath.Clean(p.Dir) == filepath.Join(r.ModuleRoot, "internal", dir) {
				c.selected[path] = p
				found++
			}
		}
		if found != 1 {
			return fmt.Errorf("compiler-selected package %s count=%d", dir, found)
		}
	}
	pinByPath := map[string]pin{}
	for _, p := range c.selected {
		if len(p.CgoFiles) != 0 || len(p.GoFiles) == 0 {
			return fmt.Errorf("unsupported Cgo or empty own package %s", p.ImportPath)
		}
		co := cohort{PackagePath: p.ImportPath, Name: p.Name, GOOS: "windows", GOARCH: "amd64", GoFiles: []string{}, ExcludedTestFiles: []string{}, IgnoredGoFiles: []string{}}
		for _, group := range []struct {
			names []string
			role  string
		}{{p.GoFiles, "compiled"}, {p.TestGoFiles, "test"}, {p.XTestGoFiles, "external-test"}, {p.IgnoredGoFiles, "build-excluded"}} {
			for _, name := range group.names {
				full := filepath.Join(p.Dir, name)
				pin, b, err := sourcePin(r.ModuleRoot, full, group.role)
				if err != nil {
					return err
				}
				pinByPath[pin.Path] = pin
				c.contents[full] = b
				switch group.role {
				case "compiled":
					co.GoFiles = append(co.GoFiles, pin.Path)
				case "build-excluded":
					co.IgnoredGoFiles = append(co.IgnoredGoFiles, pin.Path)
				default:
					co.ExcludedTestFiles = append(co.ExcludedTestFiles, pin.Path)
				}
			}
		}
		sort.Strings(co.GoFiles)
		sort.Strings(co.ExcludedTestFiles)
		sort.Strings(co.IgnoredGoFiles)
		r.Packages = append(r.Packages, co)
	}
	for _, name := range []string{"go.mod", "go.sum"} {
		full := filepath.Join(r.ModuleRoot, name)
		if _, err := os.Stat(full); errors.Is(err, os.ErrNotExist) && name == "go.sum" {
			continue
		}
		p, _, err := sourcePin(r.ModuleRoot, full, "module")
		if err != nil {
			return err
		}
		pinByPath[p.Path] = p
	}
	if len(pinByPath) > 128 {
		return errors.New("source file bound exceeded")
	}
	for _, p := range pinByPath {
		if initial, ok := before[p.Path]; !ok || initial.SHA256 != p.SHA256 {
			return fmt.Errorf("source changed during compiler selection: %s", p.Path)
		}
		r.SourcePins = append(r.SourcePins, p)
	}
	sort.Slice(r.SourcePins, func(i, j int) bool { return r.SourcePins[i].Path < r.SourcePins[j].Path })
	sort.Slice(r.Packages, func(i, j int) bool { return r.Packages[i].PackagePath < r.Packages[j].PackagePath })
	c.external = importer.ForCompiler(c.fset, "gc", func(path string) (io.ReadCloser, error) {
		p, ok := c.packages[path]
		if !ok || p.Export == "" {
			return nil, fmt.Errorf("missing compiler export for %s", path)
		}
		return os.Open(p.Export)
	})
	paths := make([]string, 0, len(c.selected))
	for path := range c.selected {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		if _, err := c.check(path); err != nil {
			return err
		}
	}
	if err := collect(r, c); err != nil {
		return err
	}
	for _, p := range r.SourcePins {
		now, _, err := sourcePin(r.ModuleRoot, filepath.Join(r.ModuleRoot, filepath.FromSlash(p.Path)), p.Role)
		if err != nil {
			return fmt.Errorf("source changed during inventory: %s: %w", p.Path, err)
		}
		if now.SHA256 != p.SHA256 {
			return fmt.Errorf("source changed during inventory: %s", p.Path)
		}
	}
	return nil
}
func main() {
	r := report{Version: 1, Status: "INCOMPLETE", Packages: []cohort{}, SourcePins: []pin{}, Definitions: []definition{}, References: []reference{}, Errors: []string{}, Exclusions: []string{"definitions: named functions and methods only, including unexported", "references: explicit identifier uses/selections targeting selected named function/method definitions; duplicates deduplicated by source-range+target", "tests, build-excluded files, external definitions, builtins, fields, locals, implicit definitions and call-graph inference are outside this golden"}}
	flag.StringVar(&r.ModuleRoot, "module-root", "", "absolute frozen module root")
	flag.StringVar(&r.GoExecutable, "go", "", "absolute native Go executable")
	var output string
	flag.StringVar(&output, "output", "", "new absolute caller-owned report path")
	flag.Parse()
	if !filepath.IsAbs(output) {
		fmt.Fprintln(os.Stderr, "absolute output path required")
		os.Exit(2)
	}
	err := inventory(&r)
	if err != nil {
		r.Errors = append(r.Errors, err.Error())
		r.Definitions = []definition{}
		r.References = []reference{}
	} else {
		r.Status = "COMPLETE"
	}
	encoded, marshalErr := json.MarshalIndent(r, "", "  ")
	if marshalErr != nil {
		fmt.Fprintln(os.Stderr, marshalErr)
		os.Exit(2)
	}
	f, writeErr := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if writeErr == nil {
		_, writeErr = f.Write(append(encoded, '\n'))
		writeErr = errors.Join(writeErr, f.Close())
	}
	if writeErr != nil {
		fmt.Fprintln(os.Stderr, writeErr)
		os.Exit(2)
	}
	fmt.Println(output)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
