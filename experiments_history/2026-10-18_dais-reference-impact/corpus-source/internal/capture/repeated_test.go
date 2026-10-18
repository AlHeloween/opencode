package capture

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func fixtureCommit(t *testing.T, c Config, repo string) string {
	t.Helper()
	for _, args := range [][]string{{"addremove"}, {"commit", "-m", "repeated fixture", "--hash", "--no-warnings", "--no-prompt", "--nosign", "--nosync", "--allow-empty"}} {
		cmd := exec.Command(os.Getenv("DAIS_TEST_FOSSIL"), args...)
		cmd.Dir = filepath.Join(filepath.Dir(repo), "checkout")
		cmd.Env = append(os.Environ(), "FOSSIL_HOME="+filepath.Join(filepath.Dir(repo), "home"))
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("fixture commit %v: %v: %s", args, err, out)
		}
	}
	head, err := c.Provider.Head(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return head.Hash
}

func publishedFixture(t *testing.T) (Config, string, map[string][]byte) {
	t.Helper()
	c, repo := fixture(t)
	c.MaxFileBytes = 16384
	c.MaxSourceBytes = 65536
	checkout := filepath.Join(filepath.Dir(repo), "checkout")
	if err := writeNew(filepath.Join(checkout, "derived", "notes Ω.txt"), []byte("ordinary source")); err != nil {
		t.Fatal(err)
	}
	c.SourceRevision = fixtureCommit(t, c, repo)
	if _, err := Run(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	raw := map[string][]byte{}
	for _, name := range []string{c.IndexPath, c.ManifestPath, c.ReceiptPath} {
		raw[name] = read(t, filepath.Join(c.BundleDirectory, filepath.FromSlash(name)))
		if err := writeNew(filepath.Join(checkout, filepath.FromSlash(name)), raw[name]); err != nil {
			t.Fatal(err)
		}
	}
	c.SourceRevision = fixtureCommit(t, c, repo)
	c.PreviousBundleRevision = c.SourceRevision
	c.BundleDirectory = filepath.Join(filepath.Dir(repo), "replacement")
	c.Environment = append(c.Environment, "DAIS_CAPTURE_REPEATED=1")
	return c, repo, raw
}

func TestRepeatedCaptureExplicitIdentityAndDirectProvenance(t *testing.T) {
	c, repo, old := publishedFixture(t)
	previous := c.SourceRevision
	if err := writeNew(filepath.Join(filepath.Dir(repo), "checkout", "changed.txt"), []byte("change")); err != nil {
		t.Fatal(err)
	}
	c.SourceRevision = fixtureCommit(t, c, repo)
	before := digest(read(t, repo))
	without := c
	without.PreviousBundleRevision = ""
	if r, err := Run(context.Background(), without); err == nil || r.Result != "FAILED" {
		t.Fatalf("implicit replacement allowed %+v %v", r, err)
	}
	r, err := Run(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	if r.PreviousBundle == nil || r.PreviousBundle.Revision != previous || len(r.PreviousBundle.Artifacts) != 3 {
		t.Fatalf("missing direct prior binding %+v", r)
	}
	var actual []string
	for _, in := range r.SourceInputs {
		actual = append(actual, in.Path)
	}
	if !reflect.DeepEqual(actual, []string{"changed.txt", "derived/notes Ω.txt", "строка space.txt"}) {
		t.Fatalf("source omission %v", actual)
	}
	want := []Input{}
	for name, data := range old {
		want = append(want, Input{Path: name, SHA256: digest(data)})
	}
	sort.Slice(want, func(i, j int) bool { return want[i].Path < want[j].Path })
	if !reflect.DeepEqual(r.PreviousBundle.Artifacts, want) {
		t.Fatalf("prior hashes %+v != %+v", r.PreviousBundle.Artifacts, want)
	}
	if before != digest(read(t, repo)) {
		t.Fatal("capture mutated source repository")
	}
	for _, name := range []string{c.IndexPath, c.ManifestPath, c.ReceiptPath} {
		data := read(t, filepath.Join(c.BundleDirectory, filepath.FromSlash(name)))
		if err := os.WriteFile(filepath.Join(filepath.Dir(repo), "checkout", filepath.FromSlash(name)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	c.SourceRevision = fixtureCommit(t, c, repo)
	c.PreviousBundleRevision = c.SourceRevision
	c.BundleDirectory = filepath.Join(filepath.Dir(repo), "third-capture")
	if next, err := Run(context.Background(), c); err != nil || next.PreviousBundle == nil {
		t.Fatalf("direct repeated receipt rejected %+v %v", next, err)
	}
}

func TestRepeatedCaptureRefusesInvalidPriorBundles(t *testing.T) {
	for _, kind := range []string{"invalid-ref", "missing-ref", "partial", "current-mismatch", "receipt-result", "receipt-source-digest", "receipt-index-digest", "manifest-index-digest", "manifest-receipt-digest", "manifest-extra", "input-alias", "input-output-prefix", "duplicate-json", "unknown-json", "trailing-json", "prior-provenance", "index-bound", "receipt-bound"} {
		t.Run(kind, func(t *testing.T) {
			c, repo, raw := publishedFixture(t)
			var receipt Receipt
			var manifest Manifest
			if err := json.Unmarshal(raw[c.ReceiptPath], &receipt); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw[c.ManifestPath], &manifest); err != nil {
				t.Fatal(err)
			}
			rewrite := false
			switch kind {
			case "invalid-ref":
				c.PreviousBundleRevision = "trunk"
			case "missing-ref":
				c.PreviousBundleRevision = strings.Repeat("e", 64)
			case "partial":
				if err := os.Remove(filepath.Join(filepath.Dir(repo), "checkout", filepath.FromSlash(c.ReceiptPath))); err != nil {
					t.Fatal(err)
				}
				c.SourceRevision = fixtureCommit(t, c, repo)
				c.PreviousBundleRevision = c.SourceRevision
			case "current-mismatch":
				raw[c.IndexPath] = []byte("different current index")
			case "receipt-result":
				receipt.Result = "FAILED"
				rewrite = true
			case "receipt-source-digest":
				receipt.SourceInputDigest = strings.Repeat("0", 64)
				rewrite = true
			case "receipt-index-digest":
				receipt.IndexSHA256 = strings.Repeat("0", 64)
				rewrite = true
			case "manifest-index-digest":
				manifest.IndexSHA256 = strings.Repeat("0", 64)
			case "manifest-receipt-digest":
				for i := range manifest.Inputs {
					if manifest.Inputs[i].Path == c.ReceiptPath {
						manifest.Inputs[i].SHA256 = strings.Repeat("0", 64)
					}
				}
			case "manifest-extra":
				manifest.Inputs = append(manifest.Inputs, Input{Path: "extra", SHA256: strings.Repeat("1", 64)})
			case "input-alias":
				receipt.SourceInputs = append(receipt.SourceInputs, Input{Path: "DERIVED/notes Ω.txt", SHA256: strings.Repeat("1", 64)})
				rewrite = true
			case "input-output-prefix":
				receipt.SourceInputs = append(receipt.SourceInputs, Input{Path: "derived/index.scip/child", SHA256: strings.Repeat("1", 64)})
				rewrite = true
			case "prior-provenance":
				receipt.PreviousBundle = &PreviousBundle{Revision: strings.Repeat("a", 64), Artifacts: []Input{{Path: c.IndexPath, SHA256: strings.Repeat("1", 64)}}}
				rewrite = true
			case "index-bound":
				c.MaxIndexBytes = 1
			case "receipt-bound":
				c.MaxFileBytes = 1
			}
			if rewrite {
				if kind == "input-alias" || kind == "input-output-prefix" {
					sort.Slice(receipt.SourceInputs, func(i, j int) bool { return receipt.SourceInputs[i].Path < receipt.SourceInputs[j].Path })
					encoded, err := json.Marshal(receipt.SourceInputs)
					if err != nil {
						t.Fatal(err)
					}
					receipt.SourceInputDigest = digest(encoded)
				}
				encoded, err := json.Marshal(receipt)
				if err != nil {
					t.Fatal(err)
				}
				raw[c.ReceiptPath] = encoded
				for i := range manifest.Inputs {
					if manifest.Inputs[i].Path == c.ReceiptPath {
						manifest.Inputs[i].SHA256 = digest(encoded)
					}
				}
			}
			if kind == "duplicate-json" {
				raw[c.ReceiptPath] = append([]byte(`{"version":1,`), raw[c.ReceiptPath][1:]...)
			}
			if kind == "unknown-json" {
				raw[c.ReceiptPath] = append([]byte(`{"unexpected":true,`), raw[c.ReceiptPath][1:]...)
			}
			if kind == "trailing-json" {
				raw[c.ReceiptPath] = append(raw[c.ReceiptPath], []byte(` {}`)...)
			}
			if kind != "manifest-receipt-digest" {
				for i := range manifest.Inputs {
					if manifest.Inputs[i].Path == c.ReceiptPath {
						manifest.Inputs[i].SHA256 = digest(raw[c.ReceiptPath])
					}
				}
			}
			encoded, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			raw[c.ManifestPath] = encoded
			if kind != "partial" && kind != "invalid-ref" && kind != "missing-ref" && kind != "index-bound" && kind != "receipt-bound" {
				for name, data := range raw {
					if err := os.WriteFile(filepath.Join(filepath.Dir(repo), "checkout", filepath.FromSlash(name)), data, 0600); err != nil {
						t.Fatal(err)
					}
				}
				c.SourceRevision = fixtureCommit(t, c, repo)
				if kind != "current-mismatch" {
					c.PreviousBundleRevision = c.SourceRevision
				}
			}
			before := digest(read(t, repo))
			r, err := Run(context.Background(), c)
			if err == nil || r.Result != "FAILED" || r.ExitCode != -1 {
				t.Fatalf("invalid prior accepted/launched: %+v %v", r, err)
			}
			if _, err := os.Stat(c.BundleDirectory); !os.IsNotExist(err) {
				t.Fatalf("failed replacement published bundle %v", err)
			}
			if before != digest(read(t, repo)) {
				t.Fatal("failed replacement changed repository")
			}
		})
	}
}
