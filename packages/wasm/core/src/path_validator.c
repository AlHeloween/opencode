/*
 * Path validator for CLI commands — compiled to WASM.
 *
 * Deterministic, no-stdlib checks used before shell execution to produce
 * agent-facing feedback (not hard blocks). The host TS layer formats the report.
 *
 * Memory (imported from host):
 *   Host writes UTF-8 path at PATH_OFFSET, worktree at WORKTREE_OFFSET,
 *   optional blocked-prefix list at BLOCKED_OFFSET (NUL-separated, double-NUL end).
 *
 * Exports:
 *   pv_validate(path_len, worktree_len, blocked_len, flags) -> issue code
 *     0 = ok
 *     1 = double drive letter (e.g. D:\D:\path)
 *     2 = system directory
 *     3 = .git path
 *     4 = outside worktree
 *     5 = blocked prefix (config)
 *     6 = empty / invalid path
 *
 * flags bit0 = check system, bit1 = check git, bit2 = check outside worktree
 */

typedef __SIZE_TYPE__ size_t;
typedef __UINT8_TYPE__ uint8_t;
typedef __UINT32_TYPE__ uint32_t;
#define NULL ((void *)0)

/* Offsets must be non-zero: C treats pointer value 0 as NULL and optimizes away loads. */
#define PATH_OFFSET 256
#define WORKTREE_OFFSET 4352
#define BLOCKED_OFFSET 8448
#define MAX_PATH 4096
/* Host provides linear memory via env.memory import; we only read fixed offsets. */

static int is_sep(unsigned char c) {
  return c == '/' || c == '\\';
}

static int is_alpha(unsigned char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

static unsigned char lower(unsigned char c) {
  if (c >= 'A' && c <= 'Z') return (unsigned char)(c + 32);
  return c;
}

static int ieq_n(const unsigned char *a, const unsigned char *b, size_t n) {
  size_t i;
  for (i = 0; i < n; i++) {
    if (lower(a[i]) != lower(b[i])) return 0;
  }
  return 1;
}

/* Match prefix then end-of-string or path separator. */
static int prefix_boundary_ci(const unsigned char *s, size_t slen, const char *pfx) {
  size_t i = 0;
  while (pfx[i]) {
    if (i >= slen) return 0;
    if (lower(s[i]) != lower((unsigned char)pfx[i])) return 0;
    i++;
  }
  if (i == slen) return 1;
  return is_sep(s[i]);
}

static int contains_git(const unsigned char *s, size_t len) {
  size_t i;
  for (i = 0; i + 4 <= len; i++) {
    if ((i == 0 || is_sep(s[i - 1])) &&
        lower(s[i]) == '.' &&
        lower(s[i + 1]) == 'g' &&
        lower(s[i + 2]) == 'i' &&
        lower(s[i + 3]) == 't' &&
        (i + 4 == len || is_sep(s[i + 4]))) {
      return 1;
    }
  }
  return 0;
}

static int is_system(const unsigned char *s, size_t len) {
  static const char *sys[] = {
      "C:\\Windows",
      "C:/Windows",
      "/etc",
      "/usr",
      "/bin",
      "/sbin",
      "/var",
      "/root",
      "/System",
      "/Library",
      NULL,
  };
  size_t i;
  for (i = 0; sys[i]; i++) {
    if (prefix_boundary_ci(s, len, sys[i])) return 1;
  }
  return 0;
}

/* Double drive: X:\Y: or X:/Y: */
static int is_double_drive(const unsigned char *s, size_t len) {
  if (len < 5) return 0;
  if (!is_alpha(s[0]) || s[1] != ':') return 0;
  if (!is_sep(s[2])) return 0;
  if (!is_alpha(s[3]) || s[4] != ':') return 0;
  return 1;
}

/* Outside worktree: path absolute and not under worktree (case-insensitive, sep-normalized). */
static int is_outside_worktree(const unsigned char *path, size_t plen,
                               const unsigned char *wt, size_t wlen) {
  size_t i;
  if (wlen == 0 || plen == 0) return 0;
  /* Relative paths are considered inside (resolved by host). */
  int absolute = 0;
  if (is_sep(path[0])) absolute = 1;
  else if (plen >= 2 && is_alpha(path[0]) && path[1] == ':') absolute = 1;
  if (!absolute) return 0;

  /* Strip trailing seps on worktree */
  while (wlen > 0 && is_sep(wt[wlen - 1])) wlen--;
  if (wlen == 0) return 0;

  if (plen < wlen) return 1;
  for (i = 0; i < wlen; i++) {
    unsigned char a = path[i];
    unsigned char b = wt[i];
    if (is_sep(a) && is_sep(b)) continue;
    if (lower(a) != lower(b)) return 1;
  }
  if (plen == wlen) return 0;
  return !is_sep(path[wlen]);
}

static int is_blocked(const unsigned char *path, size_t plen,
                      const unsigned char *blocked, size_t blen) {
  size_t i = 0;
  if (blen == 0 || !blocked) return 0;
  while (i < blen) {
    size_t start = i;
    size_t len = 0;
    if (blocked[i] == 0) break;
    while (i < blen && blocked[i] != 0) {
      len++;
      i++;
    }
    if (len > 0) {
      /* Manual prefix_boundary with non-NUL-terminated prefix */
      if (plen >= len && ieq_n(path, blocked + start, len) &&
          (plen == len || is_sep(path[len]))) {
        return 1;
      }
    }
    if (i < blen && blocked[i] == 0) i++; /* skip NUL */
  }
  return 0;
}

__attribute__((export_name("pv_validate")))
uint32_t pv_validate(uint32_t path_len, uint32_t worktree_len, uint32_t blocked_len, uint32_t flags) {
  const unsigned char *path = (const unsigned char *)(size_t)PATH_OFFSET;
  const unsigned char *wt = (const unsigned char *)(size_t)WORKTREE_OFFSET;
  const unsigned char *blocked = (const unsigned char *)(size_t)BLOCKED_OFFSET;

  if (path_len == 0 || path_len > MAX_PATH) return 6;
  if (worktree_len > MAX_PATH) worktree_len = MAX_PATH;
  if (blocked_len > MAX_PATH) blocked_len = MAX_PATH;

  if (is_double_drive(path, path_len)) return 1;

  if ((flags & 1u) && is_system(path, path_len)) return 2;
  if ((flags & 2u) && contains_git(path, path_len)) return 3;
  if ((flags & 4u) && is_outside_worktree(path, path_len, wt, worktree_len)) return 4;
  if (is_blocked(path, path_len, blocked, blocked_len)) return 5;

  return 0;
}

/* Keep a tiny dummy so --export-dynamic has something if needed. */
__attribute__((export_name("pv_version")))
uint32_t pv_version(void) {
  return 1;
}
