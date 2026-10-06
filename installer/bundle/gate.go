// Package bundle assembles and checks the robot installer bundle (plan robot-installer B1).
package bundle

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Gate rules, reported by name.
const (
	RuleName       = "credential-file" // a file whose name alone marks it as a credential store
	RuleField      = "key-field"       // a key/token/secret/password field with a literal value
	RulePrivateKey = "private-key"     // a PEM private key block
)

// Hit is one finding: where and by which rule, never the value.
type Hit struct {
	Path    string // slash-separated, relative to the scanned root
	Line    int    // 0 when the rule is about the file as a whole
	Rule    string
	Allowed bool
	Reason  string // the allow entry's reason when Allowed
}

func (h Hit) String() string {
	s := fmt.Sprintf("%s:%d %s", h.Path, h.Line, h.Rule)
	if h.Allowed {
		s += " (allowed: " + h.Reason + ")"
	}
	return s
}

// Allow exempts one path from one rule; Reason is required and printed with the hit.
type Allow struct {
	Path   string
	Rule   string
	Reason string
}

var (
	credentialNames = map[string]bool{
		"auth.json": true, ".env": true, "credentials": true, "credentials.json": true,
		".netrc": true, ".pgpass": true, ".git-credentials": true,
	}
	credentialName = regexp.MustCompile(`^(id_(rsa|dsa|ecdsa|ed25519)|\.env\..+|.+\.(pfx|p12))$`)
	// Text formats a config or key can live in; binaries are not read. Code is read too: upstream SearXNG hard-codes
	// a third-party key in engines/pexels.py (measured in Smit2, 2026-10-07).
	textExt = map[string]bool{
		".json": true, ".jsonc": true, ".toml": true, ".yml": true, ".yaml": true, ".ini": true, ".cfg": true,
		".conf": true, ".env": true, ".properties": true, ".pem": true, ".key": true, ".crt": true, ".cer": true,
		".py": true, ".js": true, ".mjs": true, ".cjs": true, ".ts": true,
	}
	// In code an unquoted value is an identifier (`key=get_candidate`, `token = Keyword.Reserved`) and a quoted one
	// without a digit is a name (`key: "quantifierPropertyName"`) — measured as all of Smit2's code noise, 2026-10-07.
	codeExt  = map[string]bool{".py": true, ".js": true, ".mjs": true, ".cjs": true, ".ts": true}
	keyField = regexp.MustCompile(`(?i)["']?\b(api[_-]?key|apikey|key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret[_-]?key|client[_-]?secret|secret|password|passwd|bearer)["']?\s*[:=]\s*(["']?)([^"'\s,}]*)`)
	// A literal credential: long and made of token characters (a URL, a path with spaces or a model id with ':' is not).
	tokenValue = regexp.MustCompile(`^[A-Za-z0-9_\-.+/=]{16,}$`)
	hasDigit   = regexp.MustCompile(`[0-9]`)
	// A PEM private key: the marker opening a line, or the marker followed by base64 after an escaped newline (a key
	// embedded in code). The marker alone (`_SK_START = b"-----BEGIN OPENSSH PRIVATE KEY-----"`) or a placeholder body
	// (`\\nXXXX`) is not a key.
	pemEscaped = regexp.MustCompile(`PRIVATE KEY-----(?:\\+r)?\\+n[A-Za-z0-9+/]{16}`)
)

// Scan walks root and returns every hit, allowed ones included, sorted by path and line.
func Scan(root string, allow []Allow) ([]Hit, error) {
	reasons := map[[2]string]string{}
	for _, a := range allow {
		if strings.TrimSpace(a.Reason) == "" {
			return nil, fmt.Errorf("allow entry %s/%s has no reason", a.Path, a.Rule)
		}
		reasons[[2]string{a.Path, a.Rule}] = a.Reason
	}
	var hits []Hit
	add := func(rel string, line int, rule string) {
		reason, ok := reasons[[2]string{rel, rule}]
		hits = append(hits, Hit{Path: rel, Line: line, Rule: rule, Allowed: ok, Reason: reason})
	}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		name := strings.ToLower(d.Name())
		if credentialNames[name] || credentialName.MatchString(name) {
			add(rel, 0, RuleName) // the whole file is the finding; its content is not read
			return nil
		}
		if !textExt[path.Ext(name)] {
			return nil
		}
		return scanText(p, codeExt[path.Ext(name)], func(line int, rule string) { add(rel, line, rule) })
	})
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Path != hits[j].Path {
			return hits[i].Path < hits[j].Path
		}
		return hits[i].Line < hits[j].Line
	})
	return hits, err
}

func scanText(p string, code bool, add func(line int, rule string)) error {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 64*1024*1024)
	for n := 1; sc.Scan(); n++ {
		line := sc.Text()
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "-----BEGIN") && strings.Contains(trimmed, "PRIVATE KEY-----") || pemEscaped.MatchString(line) {
			add(n, RulePrivateKey)
			continue
		}
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, ";") {
			continue
		}
		for _, m := range keyField.FindAllStringSubmatch(line, -1) {
			if tokenValue.MatchString(m[3]) && (!code || m[2] != "" && hasDigit.MatchString(m[3])) {
				add(n, RuleField)
				break
			}
		}
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("%s: %w", p, err) // a file the gate could not read is a failure, never a pass
	}
	return nil
}

// Failed reports whether any hit is not allowed.
func Failed(hits []Hit) bool {
	for _, h := range hits {
		if !h.Allowed {
			return true
		}
	}
	return false
}
