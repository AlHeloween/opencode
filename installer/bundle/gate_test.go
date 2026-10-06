package bundle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Requirement (owner, 2026-10-07: «все ключи убираем … это универсальный пакет»; plan robot-installer B1a): the staged
// bundle carries no credential of ours. The gate names path + line + rule for every hit and never the value itself.

// put writes rel under root with the given content, creating parent directories.
func put(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A fake value that looks like a real key; the test asserts it never appears in the report.
const fakeKey = "sk-FAKE0123456789abcdefFAKE"

func TestGateFailsOnPlantedCredentials(t *testing.T) {
	root := t.TempDir()
	put(t, root, "smit/auth.json", `{"openrouter":{"type":"api","key":"`+fakeKey+`"}}`)
	put(t, root, "smit/smit.jsonc", "{\n  \"provider\": {\"x\": {\"options\": {\"apiKey\": \""+fakeKey+"\"}}}\n}\n")
	put(t, root, "searxng/settings.yml", "server:\n  secret_key: \"portableFixedSecret0123456789\"\n")
	put(t, root, "certs/robot.pem", "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----\n")
	put(t, root, "config/.env", "TOKEN=abc\n")
	// Measured 2026-10-07 in Smit2: upstream SearXNG hard-codes a third-party key in engine CODE (pexels.py:29).
	put(t, root, "searxng-src/searx/engines/pexels.py", "import x\napi_key = \""+fakeKey+"\"\n")
	// Measured in bin/ 2026-10-07: the robot's own encrypted stores and their key. They are per install — the robot
	// generates the key (encrypted-json.ts:46-58) — so none of them may ship.
	put(t, root, "bin/.opencode.encryption.key", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU=")
	put(t, root, "bin/auth.json.enc", `{"version":1,"algorithm":"AES-256-GCM","iv":"x","ciphertext":"y"}`)
	put(t, root, "bin/auth.json.enc.tmp.6640.murvei3p", "")
	put(t, root, "bin/opencode.jsonc.enc", `{"version":1}`)
	// A key embedded in code as one escaped string is still a PEM block.
	put(t, root, "tools/sign.js", "const k = \"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEF\\n-----END PRIVATE KEY-----\";\n")

	hits, err := Scan(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"smit/auth.json":                      RuleName,
		"smit/smit.jsonc":                     RuleField,
		"searxng/settings.yml":                RuleField,
		"certs/robot.pem":                     RulePrivateKey,
		"config/.env":                         RuleName,
		"searxng-src/searx/engines/pexels.py": RuleField,
		"tools/sign.js":                       RulePrivateKey,
		"bin/.opencode.encryption.key":        RuleName,
		"bin/auth.json.enc":                   RuleName,
		"bin/auth.json.enc.tmp.6640.murvei3p": RuleName,
		"bin/opencode.jsonc.enc":              RuleName,
	}
	got := map[string]string{}
	for _, h := range hits {
		got[h.Path] = h.Rule
		if strings.Contains(h.String(), fakeKey) || strings.Contains(h.String(), "portableFixedSecret") {
			t.Fatalf("report leaks the value: %s", h)
		}
	}
	for path, rule := range want {
		if got[path] != rule {
			t.Errorf("%s: want rule %q, got %q (all hits: %v)", path, rule, got[path], hits)
		}
	}
	// smit.jsonc line 2 holds the key: the hit must name that line.
	for _, h := range hits {
		if h.Path == "smit/smit.jsonc" && h.Line != 2 {
			t.Errorf("smit.jsonc hit on line %d, want 2", h.Line)
		}
	}
}

func TestGatePassesCleanTreeAndExamples(t *testing.T) {
	root := t.TempDir()
	put(t, root, "smit/smit.jsonc", "{\n  // \"apiKey\": \""+fakeKey+"\"  example, commented out\n  \"model\": \"\"\n}\n")
	put(t, root, "searxng/settings.yml", "server:\n  # secret_key: \"portableFixedSecret0123456789\"\n  secret_key: \"${SEARXNG_SECRET}\"\n")
	put(t, root, "python/Lib/site-packages/certifi/cacert.pem", "-----BEGIN CERTIFICATE-----\nMIIF\n-----END CERTIFICATE-----\n")
	put(t, root, "tui/keybinds.json", `{"key": "ctrl+x", "password": "", "token": "<your token here>"}`)
	put(t, root, "smit/smit.exe", "MZ\x00\x00apiKey=\""+fakeKey+"\"") // binaries are not text configs
	// Code shapes measured as noise in Smit2 (2026-10-07): identifiers and quoted names, not literal secrets.
	put(t, root, "python/Lib/site-packages/pip/finder.py", "x = sorted(c, key=get_install_candidate_key)\ntoken = Keyword.Reserved_Declaration\n")
	put(t, root, "playwright-driver/lib/attribute.js", "const q = { key: \"quantifierPropertyName\", password: credentials.password };\n")
	// Key-parsing code names the marker; a doc example fills it with placeholders (both measured in Smit2).
	put(t, root, "python/Lib/site-packages/cryptography/ssh.py", "_SK_START = b\"-----BEGIN OPENSSH PRIVATE KEY-----\"\n")
	// Tcl's encoding tables share the extension and are not stores (83 of them in Smit2's git/mingw64/lib/tcl8.6).
	put(t, root, "git/mingw64/lib/tcl8.6/encoding/cp1251.enc", "# Encoding file: cp1251, single-byte\nS\n003F 0 1\n")
	// A doc example inside a block comment (measured in bin/node_modules/effect Config.ts:1529).
	put(t, root, "node_modules/effect/src/Config.ts", "/**\n * @example\n *     API_KEY: \"sk-1234567890abcdef1234\"\n */\n")
	put(t, root, "node/npm/definitions.js", "      key=\"-----BEGIN PRIVATE KEY-----\\\\nXXXX\\\\nXXXX\\\\n-----END PRIVATE KEY-----\"\n")

	hits, err := Scan(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 0 {
		t.Fatalf("clean tree flagged: %v", hits)
	}
}

func TestGateAllowlistNeedsReasonAndIsReported(t *testing.T) {
	root := t.TempDir()
	put(t, root, "searxng-src/searx/settings.yml", "server:\n  secret_key: \"ultrasecretkey_upstream_default\"\n")

	if _, err := Scan(root, []Allow{{Path: "searxng-src/searx/settings.yml", Rule: RuleField}}); err == nil {
		t.Fatal("an allow entry without a reason was accepted")
	}
	allow := []Allow{{Path: "searxng-src/searx/settings.yml", Rule: RuleField, Reason: "upstream default, overridden by our settings"}}
	hits, err := Scan(root, allow)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 || !hits[0].Allowed {
		t.Fatalf("an allowed hit must stay in the report, marked allowed: %v", hits)
	}
	if Failed(hits) {
		t.Fatal("only allowed hits, yet the gate failed")
	}
}

// Owner option, 2026-10-07: «можно копировать только ключи и enc — тогда plain text нету — но это опционально».
// A preset config pair passes only by name in the allow list; the provider-key store never does.
func TestGatePresetConfigPairIsAnExplicitOption(t *testing.T) {
	root := t.TempDir()
	put(t, root, "bin/.opencode.encryption.key", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU=")
	put(t, root, "bin/opencode.jsonc.enc", `{"version":1}`)
	put(t, root, "bin/auth.json.enc", `{"version":1}`)

	if hits, _ := Scan(root, nil); len(hits) != 3 || !Failed(hits) {
		t.Fatalf("by default all three must fail: %v", hits)
	}
	preset := []Allow{
		{Path: "bin/.opencode.encryption.key", Rule: RuleName, Reason: "preset config option: key of the shipped opencode.jsonc.enc"},
		{Path: "bin/opencode.jsonc.enc", Rule: RuleName, Reason: "preset config option: model pick only, no plaintext"},
	}
	hits, err := Scan(root, preset)
	if err != nil {
		t.Fatal(err)
	}
	var open []Hit
	for _, h := range hits {
		if !h.Allowed {
			open = append(open, h)
		}
	}
	if len(open) != 1 || open[0].Path != "bin/auth.json.enc" {
		t.Fatalf("with the preset allowed, only auth.json.enc may still fail: %v", open)
	}
}
