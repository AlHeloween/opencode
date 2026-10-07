package bundle

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Requirement (owner, 2026-10-07: «ключи в зашифрованное хранилище … проверь чтобы все работало»; plan B4): the
// installer hands a user's key to the INSTALLED robot, which writes it encrypted-only under its own per-install key.
// Run against the real compiled candidate; the robot's config dir is redirected by OPENCODE_TEST_CONFIG (honoured by
// packages/core/src/global.ts), so no real auth store is touched.

const candidate = `..\..\dist\bin\opencode.exe`

// cleanEnv is the process env without anything key-shaped — a client has no keys.
func cleanEnv(configDir string) []string {
	keyish := regexp.MustCompile(`(?i)(_API_KEY|_APIKEY|_TOKEN|_SECRET|_KEY|_PASSWORD)=|^OPENCODE_`)
	var out []string
	for _, kv := range os.Environ() {
		if !keyish.MatchString(kv) {
			out = append(out, kv)
		}
	}
	return append(out, "OPENCODE_TEST_CONFIG="+configDir)
}

func robot(t *testing.T) string {
	t.Helper()
	exe, err := filepath.Abs(candidate)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(exe); err != nil {
		t.Skip("skipped: the dist candidate is not built (run _build.ps1) — this test drives the real robot, there is no stand-in")
	}
	return exe
}

func TestStoreKeyLandsEncryptedOnlyAndTheRobotReadsIt(t *testing.T) {
	exe := robot(t)
	dir := t.TempDir()
	const fake = "sk-or-v1-FAKEFAKE0123456789abcdef0123456789"
	if err := StoreKey(exe, "openrouter", fake, cleanEnv(dir)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "auth.json")); err == nil {
		t.Error("a plaintext auth.json was written")
	}
	enc, err := os.ReadFile(filepath.Join(dir, "auth.json.enc"))
	if err != nil {
		t.Fatalf("no encrypted store: %v", err)
	}
	if strings.Contains(string(enc), fake) {
		t.Error("the key text is readable in auth.json.enc")
	}
	if _, err := os.Stat(filepath.Join(dir, ".opencode.encryption.key")); err != nil {
		t.Error("the robot did not create its own encryption key")
	}
	cmd := exec.Command(exe, "providers", "list")
	cmd.Env, cmd.Dir = cleanEnv(dir), dir
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "OpenRouter") {
		t.Errorf("the robot does not list the stored credential: %v\n%s", err, out)
	}
}

func TestStoreKeyRefusesAnUnknownProviderAndNamesIt(t *testing.T) {
	exe := robot(t)
	dir := t.TempDir()
	err := StoreKey(exe, "no-such-provider", "sk-x-0123456789", cleanEnv(dir))
	if err == nil || !strings.Contains(err.Error(), "no-such-provider") {
		t.Fatalf("want a refusal naming the provider, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "auth.json.enc")); err == nil {
		t.Error("a refused key still wrote the store")
	}
	if strings.Contains(err.Error(), "sk-x-0123456789") {
		t.Error("the error echoes the key")
	}
}
