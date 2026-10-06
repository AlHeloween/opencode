package bundle

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// Requirement (plan robot-installer B1b): the builder writes one hash manifest; the same inputs give a byte-identical
// manifest, and the installer's verification names every changed, missing or extra file.

func tree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	put(t, root, "smit/smit.exe", "MZ binary")
	put(t, root, "smit/config/smit.jsonc", "{}\n")
	put(t, root, "search/universal-search-service.exe", "MZ search")
	put(t, root, "README.md", "# bundle\n")
	return root
}

func manifestBytes(t *testing.T, root string) []byte {
	t.Helper()
	m, err := BuildManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	if err := m.Write(&b); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestManifestIsDeterministicAndRoundTrips(t *testing.T) {
	a, b := tree(t), tree(t)
	ma, mb := manifestBytes(t, a), manifestBytes(t, b)
	if !bytes.Equal(ma, mb) {
		t.Fatalf("same inputs, different manifests:\n%s\n---\n%s", ma, mb)
	}
	m, err := ParseManifest(bytes.NewReader(ma))
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Entries) != 4 {
		t.Fatalf("want 4 entries, got %d: %v", len(m.Entries), m.Entries)
	}
	var again bytes.Buffer
	if err := m.Write(&again); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ma, again.Bytes()) {
		t.Fatal("parse + write does not reproduce the manifest")
	}
	// The manifest written into the tree does not list itself.
	if err := os.WriteFile(filepath.Join(a, ManifestName), ma, 0o644); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(manifestBytes(t, a), ma) {
		t.Fatal("the manifest file changed its own manifest")
	}
}

func TestVerifyNamesEveryDifference(t *testing.T) {
	root := tree(t)
	m, err := BuildManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	if diffs, err := m.Verify(root); err != nil || len(diffs) != 0 {
		t.Fatalf("untouched tree: diffs %v, err %v", diffs, err)
	}
	put(t, root, "smit/config/smit.jsonc", "{ }\n") // same size class, one byte changed
	if err := os.Remove(filepath.Join(root, "README.md")); err != nil {
		t.Fatal(err)
	}
	put(t, root, "smit/auth.json", "{}") // something the builder never shipped

	diffs, err := m.Verify(root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"smit/config/smit.jsonc": DiffChanged, "README.md": DiffMissing, "smit/auth.json": DiffExtra}
	got := map[string]string{}
	for _, d := range diffs {
		got[d.Path] = d.Kind
	}
	if len(got) != len(want) {
		t.Fatalf("want %v, got %v", want, diffs)
	}
	for p, k := range want {
		if got[p] != k {
			t.Errorf("%s: want %s, got %q", p, k, got[p])
		}
	}
}

func TestParseRefusesMalformedLines(t *testing.T) {
	for _, bad := range []string{
		"nothex  12  a.txt\n",
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -1  a.txt\n",
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  0\n",
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  0  ../escape.txt\n",
	} {
		if _, err := ParseManifest(bytes.NewReader([]byte(bad))); err == nil {
			t.Errorf("accepted malformed line %q", bad)
		}
	}
}
