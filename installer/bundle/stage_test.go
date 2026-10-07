package bundle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Requirement (plan robot-installer B1c): a component is copied by an explicit list — named files and named
// directories — so anything unnamed (bin/ holds auth.json, the encryption key, *.enc, locks/, .opencode/) never
// reaches the bundle; a listed file that is missing fails the build; runtime litter inside a listed directory
// (__pycache__, *.pyc, locks, .opencode) and the component's own skip entries are left out.

func exists(t *testing.T, p string) bool {
	t.Helper()
	_, err := os.Stat(p)
	return err == nil
}

func sourceBin(t *testing.T) string {
	src := t.TempDir()
	put(t, src, "opencode.exe", "MZ robot")
	put(t, src, "opentui.dll", "MZ dll")
	put(t, src, "auth.json", `{"x":{"key":"`+fakeKey+`"}}`)
	put(t, src, ".opencode.encryption.key", "QUJD")
	put(t, src, "opencode.jsonc.enc", "{}")
	put(t, src, "locks/a.lock/meta.json", "{}")
	put(t, src, "tools/rg.exe", "MZ rg")
	put(t, src, "tools/cmd_runner.2026.07.01.exe", "MZ old")
	put(t, src, "tools/sub/__pycache__/x.cpython-312.pyc", "pyc")
	put(t, src, "tools/sub/y.pyc", "pyc")
	put(t, src, "tools/.opencode/data/log/x.log", "log")
	return src
}

func robotComponent(src string) Component {
	return Component{
		Name:  "robot",
		From:  src,
		To:    "bin",
		Files: []string{"opencode.exe", "opentui.dll"},
		Dirs:  []string{"tools"},
		Skip:  []string{"tools/cmd_runner.2026.07.01.exe"},
	}
}

func TestStageCopiesOnlyWhatIsNamed(t *testing.T) {
	src, out := sourceBin(t), t.TempDir()
	if err := Stage([]Component{robotComponent(src)}, out); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"bin/opencode.exe", "bin/opentui.dll", "bin/tools/rg.exe"} {
		if !exists(t, filepath.Join(out, rel)) {
			t.Errorf("listed %s was not staged", rel)
		}
	}
	for _, rel := range []string{
		"bin/auth.json", "bin/.opencode.encryption.key", "bin/opencode.jsonc.enc", "bin/locks",
		"bin/tools/cmd_runner.2026.07.01.exe", "bin/tools/sub/__pycache__", "bin/tools/sub/y.pyc", "bin/tools/.opencode",
	} {
		if exists(t, filepath.Join(out, rel)) {
			t.Errorf("%s reached the bundle", rel)
		}
	}
	b, err := os.ReadFile(filepath.Join(out, "bin", "opencode.exe"))
	if err != nil || string(b) != "MZ robot" {
		t.Fatalf("content not copied byte for byte: %q %v", b, err)
	}
	hits, err := Scan(out, nil)
	if err != nil || Failed(hits) {
		t.Fatalf("the staged robot fails the gate: %v %v", hits, err)
	}
}

func TestStageFailsOnAMissingListedFile(t *testing.T) {
	src, out := sourceBin(t), t.TempDir()
	c := robotComponent(src)
	c.Files = append(c.Files, "opencode-markdownify.exe")
	err := Stage([]Component{c}, out)
	if err == nil || !strings.Contains(err.Error(), "opencode-markdownify.exe") {
		t.Fatalf("a missing listed file must fail the build and be named, got %v", err)
	}
}

func TestStageFailsOnASkipThatMatchesNothing(t *testing.T) {
	src, out := sourceBin(t), t.TempDir()
	c := robotComponent(src)
	c.Skip = []string{"tools/cmd_runner.2026.07.02.exe"} // a typo: the real old copy would ship silently
	err := Stage([]Component{c}, out)
	if err == nil || !strings.Contains(err.Error(), "cmd_runner.2026.07.02.exe") {
		t.Fatalf("a skip entry that matches nothing must fail and be named, got %v", err)
	}
}

func TestStageRefusesANonEmptyOutput(t *testing.T) {
	src, out := sourceBin(t), t.TempDir()
	put(t, out, "leftover.txt", "from a previous build")
	if err := Stage([]Component{robotComponent(src)}, out); err == nil {
		t.Fatal("staging into a non-empty directory mixes builds; it must be refused")
	}
}
