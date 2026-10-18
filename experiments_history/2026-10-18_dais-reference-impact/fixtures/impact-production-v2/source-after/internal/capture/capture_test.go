package capture

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dais.local/codeintelligence/internal/fossil"
)

func TestCaptureHelper(t *testing.T) {
	if os.Getenv("DAIS_CAPTURE_HELPER") != "1" {
		return
	}
	var output string
	for i, arg := range os.Args {
		if arg == "--" && i+1 < len(os.Args) {
			output = os.Args[i+1]
			break
		}
	}
	if output == "" {
		os.Exit(20)
	}
	switch os.Getenv("DAIS_CAPTURE_MODE") {
	case "fail":
		fmt.Fprint(os.Stderr, "producer failure")
		os.Exit(7)
	case "timeout":
		time.Sleep(10 * time.Second)
	case "log":
		fmt.Fprint(os.Stdout, strings.Repeat("x", 10000))
		os.Exit(0)
	case "missing":
		os.Exit(0)
	case "empty":
		if err := os.WriteFile(output, nil, 0600); err != nil {
			os.Exit(28)
		}
		os.Exit(0)
	case "invalid-text":
		if _, err := os.Stdout.Write([]byte{255}); err != nil {
			os.Exit(29)
		}
	case "mutation":
		if err := os.WriteFile("строка space.txt", []byte("changed"), 0600); err != nil {
			os.Exit(21)
		}
	case "extra":
		if err := os.WriteFile("undeclared.cache", []byte("cache"), 0600); err != nil {
			os.Exit(22)
		}
	case "oversize":
		if err := os.WriteFile(output, bytes.Repeat([]byte{42}, 10000), 0600); err != nil {
			os.Exit(23)
		}
		os.Exit(0)
	}
	if data, err := os.ReadFile("строка space.txt"); err != nil || (string(data) != "original\r\n" && os.Getenv("DAIS_CAPTURE_MODE") != "mutation") {
		os.Exit(24)
	}
	if os.Getenv("DAIS_CAPTURE_PARENT_SECRET") != "" {
		os.Exit(25)
	}
	if os.Getenv("DAIS_CAPTURE_REPEATED") == "1" {
		for _, name := range []string{"derived/index.scip", "derived/inputs.json", "derived/capture.json"} {
			if _, err := os.Stat(name); !os.IsNotExist(err) {
				os.Exit(30)
			}
		}
		if data, err := os.ReadFile("derived/notes Ω.txt"); err != nil || string(data) != "ordinary source" {
			os.Exit(31)
		}
	}
	if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
		os.Exit(26)
	}
	if err := os.WriteFile(output, []byte{0, 255, 13, 10, 0}, 0600); err != nil {
		os.Exit(27)
	}
	fmt.Fprint(os.Stdout, "exact stdout\n")
	fmt.Fprint(os.Stderr, "exact stderr\n")
	os.Exit(0)
}

func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func read(t *testing.T, p string) []byte {
	t.Helper()
	b, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	return b
}

func fixture(t *testing.T) (Config, string) {
	t.Helper()
	dir := t.TempDir()
	checkout := filepath.Join(dir, "checkout")
	home := filepath.Join(dir, "home")
	scratch := filepath.Join(dir, "scratch space")
	for _, p := range []string{checkout, home, scratch} {
		if e := os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	executable := os.Getenv("DAIS_TEST_FOSSIL")
	if executable == "" {
		t.Fatal("DAIS_TEST_FOSSIL required")
	}
	repo := filepath.Join(dir, "repo.fsl")
	run := func(args ...string) {
		t.Helper()
		c := exec.Command(executable, args...)
		c.Dir = checkout
		c.Env = append(os.Environ(), "FOSSIL_HOME="+home)
		out, e := c.CombinedOutput()
		if e != nil {
			t.Fatalf("fossil %v: %v: %s", args, e, out)
		}
	}
	run("init", repo)
	run("open", repo, "--nested")
	if e := os.WriteFile(filepath.Join(checkout, "строка space.txt"), []byte("original\r\n"), 0600); e != nil {
		t.Fatal(e)
	}
	run("addremove")
	run("commit", "-m", "capture fixture", "--no-warnings", "--no-prompt", "--nosign", "--nosync")
	p, e := fossil.New(fossil.Config{Executable: executable, Repository: repo, FossilHome: home, HeadRef: "trunk", Timeout: 10 * time.Second, MaxOutputBytes: 1 << 20})
	if e != nil {
		t.Fatal(e)
	}
	rev, e := p.Head(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	self, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	env := []string{"DAIS_CAPTURE_HELPER=1"}
	if v := os.Getenv("SystemRoot"); v != "" {
		env = append(env, "SystemRoot="+v)
	}
	return Config{Provider: p, SourceRevision: rev.Hash, Indexer: self, IndexerSHA256: digest(read(t, self)), Args: []string{"-test.run=^TestCaptureHelper$", "--", "{index}"}, Environment: env, ScratchRoot: scratch, BundleDirectory: filepath.Join(dir, "bundle"), IndexPath: "derived/index.scip", ManifestPath: "derived/inputs.json", ReceiptPath: "derived/capture.json", MaxFiles: 10, MaxSourceBytes: 4096, MaxFileBytes: 4096, MaxIndexBytes: 4096, MaxLogBytes: 4096, Timeout: 3 * time.Second}, repo
}

func TestCaptureRawBundleAndReadonlyFossil(t *testing.T) {
	c, repo := fixture(t)
	before := digest(read(t, repo))
	t.Setenv("DAIS_CAPTURE_PARENT_SECRET", "must-not-inherit")
	r, e := Run(context.Background(), c)
	if e != nil {
		t.Fatal(e)
	}
	if r.Result != "CAPTURED" || r.SemanticStatus != "unknown" || r.ExitCode != 0 {
		t.Fatalf("receipt %+v", r)
	}
	if r.Stdout != "exact stdout\n" || r.Stderr != "exact stderr\n" {
		t.Fatalf("diagnostics %+v", r)
	}
	index := read(t, filepath.Join(c.BundleDirectory, filepath.FromSlash(c.IndexPath)))
	if !bytes.Equal(index, []byte{0, 255, 13, 10, 0}) || r.IndexSHA256 != digest(index) {
		t.Fatal("raw output changed")
	}
	var m Manifest
	if e := json.Unmarshal(read(t, filepath.Join(c.BundleDirectory, filepath.FromSlash(c.ManifestPath))), &m); e != nil {
		t.Fatal(e)
	}
	if len(m.Inputs) != 2 || m.IndexSHA256 != r.IndexSHA256 {
		t.Fatalf("manifest %+v", m)
	}
	var receiptFound bool
	for _, in := range m.Inputs {
		if in.Path == c.ReceiptPath {
			receiptFound = true
			if in.SHA256 != digest(read(t, filepath.Join(c.BundleDirectory, filepath.FromSlash(c.ReceiptPath)))) {
				t.Fatal("receipt pin mismatch")
			}
		}
	}
	if !receiptFound {
		t.Fatal("receipt not declared")
	}
	encoded, e := json.Marshal(r.SourceInputs)
	if e != nil || digest(encoded) != r.SourceInputDigest {
		t.Fatal("source canonical JSON digest differs")
	}
	var names []string
	e = filepath.WalkDir(c.BundleDirectory, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if !d.IsDir() {
			rel, e := filepath.Rel(c.BundleDirectory, p)
			if e != nil {
				return e
			}
			names = append(names, rel)
		}
		return nil
	})
	if e != nil || len(names) != 3 {
		t.Fatalf("bundle %v %v", names, e)
	}
	if before != digest(read(t, repo)) {
		t.Fatal("capture changed source repository")
	}
	entries, e := os.ReadDir(c.ScratchRoot)
	if e != nil || len(entries) != 0 {
		t.Fatalf("scratch cleanup %v %v", entries, e)
	}
}

func TestCaptureRejectsFailedLaunchesAndUnsafeInputs(t *testing.T) {
	c, repo := fixture(t)
	before := digest(read(t, repo))
	for _, mode := range []string{"fail", "timeout", "log", "missing", "empty", "invalid-text", "mutation", "extra", "oversize"} {
		t.Run(mode, func(t *testing.T) {
			cfg := c
			cfg.BundleDirectory = filepath.Join(filepath.Dir(c.BundleDirectory), mode)
			cfg.Environment = append(append([]string{}, c.Environment...), "DAIS_CAPTURE_MODE="+mode)
			if mode == "timeout" {
				cfg.Timeout = 100 * time.Millisecond
			}
			r, e := Run(context.Background(), cfg)
			if e == nil || r.Result != "FAILED" {
				t.Fatalf("mode=%s receipt=%+v err=%v", mode, r, e)
			}
			if _, e := os.Stat(cfg.BundleDirectory); !os.IsNotExist(e) {
				t.Fatalf("published failed bundle %v", e)
			}
			if mode == "fail" && (r.ExitCode != 7 || r.Stderr != "producer failure") {
				t.Fatalf("lost failed receipt %+v", r)
			}
		})
	}
	for _, mode := range []string{"pin", "duplicate-env", "case-env", "missing-systemroot", "traversal", "reserved", "case-output", "source-collision", "prefix-output", "existing-bundle", "file-bound", "source-bound", "file-count", "placeholder"} {
		t.Run(mode, func(t *testing.T) {
			cfg := c
			cfg.BundleDirectory = filepath.Join(filepath.Dir(c.BundleDirectory), mode)
			switch mode {
			case "pin":
				cfg.IndexerSHA256 = strings.Repeat("0", 64)
			case "duplicate-env":
				cfg.Environment = append(append([]string{}, c.Environment...), "A=1", "A=2")
			case "case-env":
				cfg.Environment = append(append([]string{}, c.Environment...), "Path=1", "PATH=2")
			case "missing-systemroot":
				cfg.Environment = []string{"DAIS_CAPTURE_HELPER=1"}
			case "traversal":
				cfg.IndexPath = "../index"
			case "reserved":
				cfg.IndexPath = "NUL.txt"
			case "case-output":
				cfg.ManifestPath = strings.ToUpper(cfg.IndexPath)
			case "source-collision":
				cfg.IndexPath = "строка space.txt"
			case "prefix-output":
				cfg.ReceiptPath = "derived"
			case "existing-bundle":
				if e := os.Mkdir(cfg.BundleDirectory, 0700); e != nil {
					t.Fatal(e)
				}
				if e := os.WriteFile(filepath.Join(cfg.BundleDirectory, "retained"), []byte("keep"), 0600); e != nil {
					t.Fatal(e)
				}
			case "file-bound":
				cfg.MaxFileBytes = 1
			case "source-bound":
				cfg.MaxSourceBytes = 1
			case "file-count":
				cfg.MaxFiles = 0
			case "placeholder":
				cfg.Args = append(append([]string{}, c.Args...), "{index}")
			}
			r, e := Run(context.Background(), cfg)
			if e == nil {
				t.Fatalf("accepted %s %+v", mode, r)
			}
			if r.Result == "CAPTURED" {
				t.Fatal("false captured receipt")
			}
			if r.ExitCode != -1 {
				t.Fatal("preflight failure launched the producer")
			}
			if mode == "existing-bundle" && string(read(t, filepath.Join(cfg.BundleDirectory, "retained"))) != "keep" {
				t.Fatal("existing destination modified")
			}
		})
	}
	if before != digest(read(t, repo)) {
		t.Fatal("negative control changed Fossil")
	}
}

func TestNativePathPredicates(t *testing.T) {
	for _, bad := range []string{"", ".", "../x", "/x", "a//b", "a/../b", "a\\b", "C:x", "a.", "a ", "a/NUL.txt", "con", "a/COM1.log", "LPT²", "a\n", "a|b"} {
		if repositoryPath(bad) == nil {
			t.Fatalf("accepted unsafe native path %q", bad)
		}
	}
	for _, good := range []string{"строка space.txt", "a/b.go", "a/.config", "component.name", "com0", "lpt10"} {
		if err := repositoryPath(good); err != nil {
			t.Fatalf("rejected %q: %v", good, err)
		}
	}
	parent := t.TempDir()
	from := filepath.Join(parent, "candidate")
	to := filepath.Join(parent, "existing")
	for _, dir := range []string{from, to} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := publishDirectory(from, to); err == nil {
		t.Fatal("atomic publish replaced existing directory")
	}
	if _, err := os.Stat(from); err != nil {
		t.Fatal("failed publish consumed candidate", err)
	}
}

func TestCaptureDeadlineStartsBeforeInputs(t *testing.T) {
	c, _ := fixture(t)
	c.Timeout = time.Nanosecond
	r, err := Run(context.Background(), c)
	if !errors.Is(err, context.DeadlineExceeded) || r.Result != "FAILED" || len(r.SourceInputs) != 0 {
		t.Fatalf("expired whole-capture deadline reached input materialization: receipt=%+v err=%v", r, err)
	}
	if _, err := os.Stat(c.BundleDirectory); !os.IsNotExist(err) {
		t.Fatalf("deadline published bundle: %v", err)
	}
}

func TestCancelledPublicationKeepsCandidate(t *testing.T) {
	parent := t.TempDir()
	from, to := filepath.Join(parent, "candidate"), filepath.Join(parent, "bundle")
	if err := os.Mkdir(from, 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := publish(ctx, from, to); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled publication: %v", err)
	}
	if _, err := os.Stat(to); !os.IsNotExist(err) {
		t.Fatalf("cancelled publication exists: %v", err)
	}
	if st, err := os.Stat(from); err != nil || !st.IsDir() {
		t.Fatalf("candidate lost: %v", err)
	}
}
