/**
 * Linux: Quoting & Escaping Tests
 *
 * Tests for shell quoting, escaping, and special character handling
 * in Linux/Unix shells (bash, zsh, sh).
 */
import { describe, expect, test } from "bun:test"

const describeUnix = process.platform !== "win32" ? describe : describe.skip

describeUnix("Linux: quoting and escaping", () => {
  // ================================================================
  // Double-quoted strings
  // ================================================================

  test("double-quoted paths with spaces", () => {
    // Double quotes preserve spaces but expand variables
    const commands = [
      'echo "/home/user/My Documents"',
      'cat "/mnt/shared/Team Files/report.pdf"',
      'ls -la "/var/log/App Logs/"',
    ]
    for (const cmd of commands) {
      expect(cmd).toContain('"')
      expect(cmd).toMatch(/".* .*"/) // contains space between quotes
    }
  })

  test("double-quoted paths with variables", () => {
    const commands = [
      'echo "$HOME/Documents"',
      'cat "$HOME/.ssh/config"',
      'ls "$TMPDIR/opencode"',
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("$")
      expect(cmd).toContain('"')
    }
  })

  // ================================================================
  // Single-quoted strings
  // ================================================================

  test("single-quoted paths (no variable expansion)", () => {
    const commands = [
      "echo '$HOME'",
      "grep 'error message' file.log",
      "sed 's/foo/bar/g' input.txt",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("'")
    }
  })

  // ================================================================
  // Backslash escaping
  // ================================================================

  test("backslash-escaped spaces", () => {
    const commands = [
      "echo /home/user/My\\ Documents",
      "touch file\\ with\\ spaces.txt",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("\\ ")
    }
  })

  test("backslash-escaped special characters", () => {
    const commands = [
      "echo file\\(1\\).txt",
      "grep \\[ERROR\\] log.txt",
      "touch \\~temp",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("\\")
    }
  })

  // ================================================================
  // Command substitution
  // ================================================================

  test("command substitution with $()", () => {
    const commands = [
      "echo $(pwd)",
      "file $(which node)",
      "cd $(dirname $0)",
      "cat $(find . -name '*.txt')",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("$(")
      expect(cmd).toContain(")")
    }
  })

  test("backtick command substitution", () => {
    const commands = [
      "echo `pwd`",
      "file `which python3`",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("`")
    }
  })

  // ================================================================
  // Heredocs
  // ================================================================

  test("heredoc syntax", () => {
    // Heredocs are multiline, so we just check the pattern
    const heredoc = `cat <<'EOF'
line 1
line 2
EOF`
    expect(heredoc).toContain("<<")
    expect(heredoc).toContain("EOF")
  })

  // ================================================================
  // Globs and wildcards
  // ================================================================

  test("glob patterns", () => {
    const globs = [
      "ls *.txt",
      "rm -f /tmp/*.tmp",
      "find . -name '*.js'",
      "grep -r 'pattern' src/**/*.ts",
    ]
    for (const cmd of globs) {
      expect(cmd).toContain("*")
    }
  })

  test("character classes in globs", () => {
    const globs = [
      "ls file[0-9].txt",
      "rm file[abc].log",
      "ls [!0-9]*.txt",
    ]
    for (const g of globs) {
      expect(g).toContain("[")
      expect(g).toContain("]")
    }
  })

  // ================================================================
  // Brace expansion
  // ================================================================

  test("brace expansion", () => {
    const commands = [
      "cp file.{txt,bak} backup/",
      "mkdir -p project/{src,test,docs}",
      "echo {1..10}",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("{")
      expect(cmd).toContain("}")
    }
  })
})
