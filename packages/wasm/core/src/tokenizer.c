/*
 * BPE Tokenizer in C, compiled to WASM.
 *
 * Implements byte-level BPE encoding matching the TypeScript BPETokenizer
 * from packages/opencode/src/tokenizers/bpe-encoder.ts.
 *
 * No standard library - all functions implemented inline.
 *
 * Memory layout (shared with JS via WebAssembly.Memory):
 *   [0 .. vocab_len)           - vocab JSON string
 *   [vocab_len .. vocab_len+merges_len) - merges JSON string
 *   [4096 .. 4096+text_len)    - input text (UTF-8 bytes)
 *   Output area for encode:    starts at text_ptr + text_len + 64 (i32 array)
 *   Output area for decode:    at offset 8192 (text bytes)
 */

/* ── Builtins ────────────────────────────────────────────────────────────── */
typedef __SIZE_TYPE__ size_t;
typedef __UINT8_TYPE__ uint8_t;
typedef __UINT16_TYPE__ uint16_t;
typedef __UINT32_TYPE__ uint32_t;
typedef __INT8_TYPE__ int8_t;
typedef __INT32_TYPE__ int32_t;

/* ── String helpers ──────────────────────────────────────────────────────── */
static void* my_memset(void* s, int c, size_t n) {
  unsigned char* p = (unsigned char*)s;
  while (n--) *p++ = (unsigned char)c;
  return s;
}

static void* my_memcpy(void* dest, const void* src, size_t n) {
  unsigned char* d = (unsigned char*)dest;
  const unsigned char* s = (const unsigned char*)src;
  while (n--) *d++ = *s++;
  return dest;
}

static int my_strcmp(const char* a, const char* b) {
  while (*a && *b && *a == *b) { a++; b++; }
  return (unsigned char)*a - (unsigned char)*b;
}



static char* my_strncpy(char* dest, const char* src, size_t n) {
  size_t i;
  for (i = 0; i < n && src[i]; i++) dest[i] = src[i];
  for (; i < n; i++) dest[i] = '\0';
  return dest;
}

#define memset  my_memset
#define memcpy  my_memcpy
#define strcmp  my_strcmp
#define strlen  my_strlen
#define strncpy my_strncpy
#define NULL    ((void*)0)

/* ── Configuration limits ────────────────────────────────────────────────── */
#define MAX_VOCAB_SIZE   262144  /* max vocab entries */
#define MAX_MERGES       131072  /* max merge entries */
#define MAX_TOKEN_LEN    256     /* max token string length */
#define MAX_WORD_LEN     512     /* max word (after byte-encode) */
#define MAX_TEXT_LEN     65536   /* max input text */
#define MAX_TOKENS       8192    /* max output tokens per encode */
#define CACHE_SIZE       4096    /* LRU cache entries */
#define HASH_TABLE_SIZE  524288  /* power of 2 > 2*MAX_VOCAB_SIZE */
#define MERGE_HASH_SIZE  262144  /* power of 2 > 2*MAX_MERGES */

/* ── Simple JSON parser state ────────────────────────────────────────────── */
static const char* json_skip_ws(const char* p, const char* end) {
  while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++;
  return p;
}

/* Parse a JSON string value starting at '"' into `out` (max out_len-1 chars).
   Returns pointer past closing '"', or NULL on error. */
static const char* json_parse_string(const char* p, const char* end, char* out, size_t out_len) {
  if (p >= end || *p != '"') return NULL;
  p++;
  size_t i = 0;
  while (p < end && *p != '"' && i < out_len - 1) {
    if (*p == '\\') {
      p++;
      if (p >= end) return NULL;
      switch (*p) {
        case '"':  out[i++] = '"';  break;
        case '\\': out[i++] = '\\'; break;
        case '/':  out[i++] = '/';  break;
        case 'b':  out[i++] = '\b'; break;
        case 'f':  out[i++] = '\f'; break;
        case 'n':  out[i++] = '\n'; break;
        case 'r':  out[i++] = '\r'; break;
        case 't':  out[i++] = '\t'; break;
        case 'u': {
          if (p + 4 >= end) return NULL;
          uint32_t cp = 0;
          int j;
          for (j = 0; j < 4; j++) {
            p++;
            char c = *p;
            cp <<= 4;
            if (c >= '0' && c <= '9') cp |= (c - '0');
            else if (c >= 'a' && c <= 'f') cp |= (c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') cp |= (c - 'A' + 10);
            else return NULL;
          }
          if (cp < 0x80) {
            out[i++] = (char)cp;
          } else if (cp < 0x800) {
            out[i++] = (char)(0xC0 | (cp >> 6));
            out[i++] = (char)(0x80 | (cp & 0x3F));
          } else {
            out[i++] = (char)(0xE0 | (cp >> 12));
            out[i++] = (char)(0x80 | ((cp >> 6) & 0x3F));
            out[i++] = (char)(0x80 | (cp & 0x3F));
          }
          break;
        }
        default: return NULL;
      }
    } else {
      out[i++] = *p;
    }
    p++;
  }
  out[i] = '\0';
  if (p >= end || *p != '"') return NULL;
  return p + 1;
}

/* Parse a JSON integer (positive or negative) starting at p. */
static const char* json_parse_int(const char* p, const char* end, int32_t* out) {
  int neg = 0;
  if (p < end && *p == '-') { neg = 1; p++; }
  if (p >= end || *p < '0' || *p > '9') return NULL;
  int32_t val = 0;
  while (p < end && *p >= '0' && *p <= '9') {
    val = val * 10 + (*p - '0');
    p++;
  }
  *out = neg ? -val : val;
  return p;
}

/* ── Hash table for vocab (string → slot index) ─────────────────────────── */
typedef struct {
  char    keys[MAX_VOCAB_SIZE][MAX_TOKEN_LEN];
  int32_t vals[MAX_VOCAB_SIZE];
  uint8_t slot_used[MAX_VOCAB_SIZE];  /* per-slot occupancy */
  uint32_t hash_to_slot[HASH_TABLE_SIZE]; /* hash bucket → slot */
  uint8_t bucket_used[HASH_TABLE_SIZE / 8];
} VocabHash;

static uint32_t hash_string(const char* s) {
  uint32_t h = 2166136261u;
  while (*s) {
    h ^= (uint8_t)*s++;
    h *= 16777619u;
  }
  return h;
}

static void vocab_init(VocabHash* h) {
  my_memset(h->slot_used, 0, sizeof(h->slot_used));
  my_memset(h->bucket_used, 0, sizeof(h->bucket_used));
}

static int vocab_insert(VocabHash* h, const char* key, int32_t val) {
  /* Find slot via linear probing on hash table */
  uint32_t mask = HASH_TABLE_SIZE - 1;
  uint32_t hash = hash_string(key);
  uint32_t idx = hash & mask;
  uint32_t start = idx;

  do {
    if (!(h->bucket_used[idx >> 3] & (1u << (idx & 7)))) {
      /* Bucket empty - allocate a new slot */
      uint32_t slot = 0;
      while (slot < MAX_VOCAB_SIZE && h->slot_used[slot]) slot++;
      if (slot >= MAX_VOCAB_SIZE) return -1;

      h->bucket_used[idx >> 3] |= (1u << (idx & 7));
      h->hash_to_slot[idx] = slot;
      h->slot_used[slot] = 1;
      my_strncpy(h->keys[slot], key, MAX_TOKEN_LEN - 1);
      h->keys[slot][MAX_TOKEN_LEN - 1] = '\0';
      h->vals[slot] = val;
      return (int)slot;
    }
    /* Check if existing entry matches */
    uint32_t slot = h->hash_to_slot[idx];
    if (my_strcmp(h->keys[slot], key) == 0) {
      h->vals[slot] = val; /* update */
      return (int)slot;
    }
    idx = (idx + 1) & mask;
  } while (idx != start);

  return -1;
}

static int vocab_lookup(const VocabHash* h, const char* key) {
  uint32_t mask = HASH_TABLE_SIZE - 1;
  uint32_t hash = hash_string(key);
  uint32_t idx = hash & mask;
  uint32_t start = idx;

  do {
    if (!(h->bucket_used[idx >> 3] & (1u << (idx & 7)))) return -1;
    uint32_t slot = h->hash_to_slot[idx];
    if (my_strcmp(h->keys[slot], key) == 0) return (int)slot;
    idx = (idx + 1) & mask;
  } while (idx != start);

  return -1;
}

/* ── Hash table for merges ("tokA tokB" → rank) ─────────────────────────── */
typedef struct {
  char    keys[MAX_MERGES][MAX_TOKEN_LEN * 2 + 2];
  int32_t vals[MAX_MERGES];
  uint8_t slot_used[MAX_MERGES];
  uint32_t hash_to_slot[MERGE_HASH_SIZE];
  uint8_t bucket_used[MERGE_HASH_SIZE / 8];
} MergeHash;

static void merges_init(MergeHash* h) {
  my_memset(h->slot_used, 0, sizeof(h->slot_used));
  my_memset(h->bucket_used, 0, sizeof(h->bucket_used));
}

static int merges_insert(MergeHash* h, const char* key, int32_t val) {
  uint32_t mask = MERGE_HASH_SIZE - 1;
  uint32_t hash = hash_string(key);
  uint32_t idx = hash & mask;
  uint32_t start = idx;

  do {
    if (!(h->bucket_used[idx >> 3] & (1u << (idx & 7)))) {
      uint32_t slot = 0;
      while (slot < MAX_MERGES && h->slot_used[slot]) slot++;
      if (slot >= MAX_MERGES) return -1;

      h->bucket_used[idx >> 3] |= (1u << (idx & 7));
      h->hash_to_slot[idx] = slot;
      h->slot_used[slot] = 1;
      my_strncpy(h->keys[slot], key, sizeof(h->keys[slot]) - 1);
      h->keys[slot][sizeof(h->keys[slot]) - 1] = '\0';
      h->vals[slot] = val;
      return (int)slot;
    }
    uint32_t slot = h->hash_to_slot[idx];
    if (my_strcmp(h->keys[slot], key) == 0) {
      h->vals[slot] = val;
      return (int)slot;
    }
    idx = (idx + 1) & mask;
  } while (idx != start);

  return -1;
}

static int merges_lookup(const MergeHash* h, const char* key) {
  uint32_t mask = MERGE_HASH_SIZE - 1;
  uint32_t hash = hash_string(key);
  uint32_t idx = hash & mask;
  uint32_t start = idx;

  do {
    if (!(h->bucket_used[idx >> 3] & (1u << (idx & 7)))) return -1;
    uint32_t slot = h->hash_to_slot[idx];
    if (my_strcmp(h->keys[slot], key) == 0) return (int)slot;
    idx = (idx + 1) & mask;
  } while (idx != start);

  return -1;
}

/* ── Global tokenizer state (single instance) ────────────────────────────── */
static VocabHash g_vocab;
static MergeHash g_merges;
static int g_initialized = 0;

/* Reverse vocab: slot pointer for each token ID */
static char* g_reverse_vocab[MAX_VOCAB_SIZE];
static int g_vocab_count = 0;

/* ── Byte-to-Unicode mapping (GPT-2 style) ───────────────────────────────── */
static uint16_t byte_to_unicode[256];

static void init_byte_to_unicode(void) {
  int next = 256;
  for (int b = 0; b < 256; b++) {
    if (b >= 33 && b <= 126) {
      byte_to_unicode[b] = (uint16_t)b;
    } else {
      byte_to_unicode[b] = (uint16_t)next;
      next++;
    }
  }
}

static int8_t unicode_to_byte[4096];
static int g_byte_map_inited = 0;

static void init_unicode_to_byte(void) {
  if (g_byte_map_inited) return;
  my_memset(unicode_to_byte, 0xFF, sizeof(unicode_to_byte));
  for (int b = 0; b < 256; b++) {
    uint16_t uc = byte_to_unicode[b];
    if (uc < 4096) {
      unicode_to_byte[uc] = (int8_t)b;
    }
  }
  g_byte_map_inited = 1;
}

/* ── Pre-tokenization (simplified ASCII-compatible) ──────────────────────── */
static int is_alpha(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

static int is_digit(char c) {
  return c >= '0' && c <= '9';
}

static int is_space(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

static int contraction_len(const char* s, int remaining) {
  if (remaining < 2 || s[0] != '\'') return 0;
  if (remaining >= 2 && (s[1] == 's' || s[1] == 't' || s[1] == 'm' || s[1] == 'd')) {
    if (remaining == 2 || !is_alpha(s[2])) return 2;
  }
  if (remaining >= 3 && s[1] == 'r' && s[2] == 'e') {
    if (remaining == 3 || !is_alpha(s[3])) return 3;
  }
  if (remaining >= 3 && s[1] == 'v' && s[2] == 'e') {
    if (remaining == 3 || !is_alpha(s[3])) return 3;
  }
  if (remaining >= 4 && s[1] == 'l' && s[2] == 'l') {
    if (remaining == 4 || !is_alpha(s[3])) return 4;
  }
  return 0;
}

static int pretokenize(const char* text, int text_len,
                       int* offsets, int* lengths, int max_chunks) {
  int n = 0;
  int i = 0;
  while (i < text_len && n < max_chunks) {
    /* Check for contraction */
    if (n > 0 && text[i] == '\'') {
      int cl = contraction_len(&text[i], text_len - i);
      if (cl > 0) {
        offsets[n] = i;
        lengths[n] = cl;
        n++;
        i += cl;
        continue;
      }
    }

    if (is_space(text[i])) {
      int start = i;
      while (i < text_len && is_space(text[i])) i++;
      offsets[n] = start;
      lengths[n] = i - start;
      n++;
    } else if (is_alpha(text[i])) {
      int start = i;
      while (i < text_len && (is_alpha(text[i]) || (text[i] == '\'' && contraction_len(&text[i], text_len - i) == 0))) i++;
      offsets[n] = start;
      lengths[n] = i - start;
      n++;
    } else if (is_digit(text[i])) {
      int start = i;
      while (i < text_len && is_digit(text[i])) i++;
      offsets[n] = start;
      lengths[n] = i - start;
      n++;
    } else {
      int start = i;
      while (i < text_len && !is_space(text[i]) && !is_alpha(text[i]) && !is_digit(text[i])) i++;
      offsets[n] = start;
      lengths[n] = i - start;
      n++;
    }
  }
  return n;
}

/* ── Convert a word (UTF-8) to byte-level unicode characters ─────────────── */
static int word_to_byte_chars(const char* word, int word_len,
                              uint16_t* out_cps, int max_cps) {
  uint8_t bytes[MAX_WORD_LEN];
  int n_bytes = 0;

  int i = 0;
  while (i < word_len && n_bytes < MAX_WORD_LEN) {
    uint8_t c = (uint8_t)word[i];
    if (c < 0x80) {
      bytes[n_bytes++] = c;
      i++;
    } else if ((c & 0xE0) == 0xC0) {
      if (i + 1 < word_len) {
        uint8_t b = ((c & 0x1F) << 6) | ((uint8_t)word[i+1] & 0x3F);
        bytes[n_bytes++] = b;
        i += 2;
      } else break;
    } else if ((c & 0xF0) == 0xE0) {
      if (i + 2 < word_len) {
        uint32_t cp = ((uint32_t)(c & 0x0F) << 12) |
                      ((uint32_t)((uint8_t)word[i+1] & 0x3F) << 6) |
                      ((uint32_t)((uint8_t)word[i+2] & 0x3F));
        if (cp < 256) {
          bytes[n_bytes++] = (uint8_t)cp;
        } else {
          if (cp >> 16) bytes[n_bytes++] = (uint8_t)(cp >> 16);
          if ((cp >> 8) & 0xFF) bytes[n_bytes++] = (uint8_t)((cp >> 8) & 0xFF);
          bytes[n_bytes++] = (uint8_t)(cp & 0xFF);
        }
        i += 3;
      } else break;
    } else if ((c & 0xF8) == 0xF0) {
      if (i + 3 < word_len) {
        uint32_t cp = ((uint32_t)(c & 0x07) << 18) |
                      ((uint32_t)((uint8_t)word[i+1] & 0x3F) << 12) |
                      ((uint32_t)((uint8_t)word[i+2] & 0x3F) << 6) |
                      ((uint32_t)((uint8_t)word[i+3] & 0x3F));
        if (cp < 256) {
          bytes[n_bytes++] = (uint8_t)cp;
        } else {
          if (cp >> 24) bytes[n_bytes++] = (uint8_t)(cp >> 24);
          if ((cp >> 16) & 0xFF) bytes[n_bytes++] = (uint8_t)((cp >> 16) & 0xFF);
          if ((cp >> 8) & 0xFF) bytes[n_bytes++] = (uint8_t)((cp >> 8) & 0xFF);
          bytes[n_bytes++] = (uint8_t)(cp & 0xFF);
        }
        i += 4;
      } else break;
    } else {
      i++;
    }
  }

  int n_cps = 0;
  for (i = 0; i < n_bytes && n_cps < max_cps; i++) {
    out_cps[n_cps++] = byte_to_unicode[bytes[i]];
  }
  return n_cps;
}

/* ── Encode codepoint to UTF-8 string ────────────────────────────────────── */
static int cp_to_utf8(uint16_t cp, char* out, int out_len) {
  if (cp < 0x80) {
    if (out_len < 1) return 0;
    out[0] = (char)cp;
    return 1;
  } else if (cp < 0x800) {
    if (out_len < 2) return 0;
    out[0] = (char)(0xC0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3F));
    return 2;
  } else {
    if (out_len < 3) return 0;
    out[0] = (char)(0xE0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    return 3;
  }
}

/* ── BPE merge algorithm ─────────────────────────────────────────────────── */
static int bpe_merge(char tokens[][MAX_TOKEN_LEN], int n_tokens) {
  while (n_tokens > 1) {
    int best_rank = -1;
    int best_idx = -1;

    for (int i = 0; i < n_tokens - 1; i++) {
      char pair[MAX_TOKEN_LEN * 2 + 2];
      int len = 0;
      int j;
      for (j = 0; tokens[i][j] && len < (int)sizeof(pair) - 2; j++) pair[len++] = tokens[i][j];
      pair[len++] = ' ';
      for (j = 0; tokens[i+1][j] && len < (int)sizeof(pair) - 1; j++) pair[len++] = tokens[i+1][j];
      pair[len] = '\0';

      int slot = merges_lookup(&g_merges, pair);
      if (slot >= 0) {
        int rank = g_merges.vals[slot];
        if (best_rank == -1 || rank < best_rank) {
          best_rank = rank;
          best_idx = i;
        }
      }
    }

    if (best_idx == -1) break;

    /* Merge */
    char merged[MAX_TOKEN_LEN];
    int len = 0;
    int j;
    for (j = 0; tokens[best_idx][j] && len < MAX_TOKEN_LEN - 1; j++) merged[len++] = tokens[best_idx][j];
    for (j = 0; tokens[best_idx+1][j] && len < MAX_TOKEN_LEN - 1; j++) merged[len++] = tokens[best_idx+1][j];
    merged[len] = '\0';

    my_strncpy(tokens[best_idx], merged, MAX_TOKEN_LEN - 1);
    tokens[best_idx][MAX_TOKEN_LEN - 1] = '\0';

    int k;
    for (k = best_idx + 1; k < n_tokens - 1; k++) {
      my_memcpy(tokens[k], tokens[k+1], MAX_TOKEN_LEN);
    }
    n_tokens--;
  }

  return n_tokens;
}

/* ── LRU Cache for word → token IDs ──────────────────────────────────────── */
typedef struct {
  char    keys[CACHE_SIZE][MAX_WORD_LEN];
  int32_t ids[CACHE_SIZE][MAX_TOKENS];
  int     id_counts[CACHE_SIZE];
  uint32_t ages[CACHE_SIZE];
  uint32_t next_age;
} Cache;

static Cache g_cache;

static void cache_init(Cache* c) {
  my_memset(c->keys, 0, sizeof(c->keys));
  my_memset(c->ages, 0, sizeof(c->ages));
  c->next_age = 1;
}

static const int32_t* cache_get(Cache* c, const char* key, int* out_count) {
  uint32_t h = hash_string(key) % CACHE_SIZE;
  uint32_t idx = h;
  uint32_t start = idx;
  do {
    if (c->keys[idx][0] == '\0') return NULL;
    if (my_strcmp(c->keys[idx], key) == 0) {
      c->ages[idx] = c->next_age++;
      *out_count = c->id_counts[idx];
      return c->ids[idx];
    }
    idx = (idx + 1) % CACHE_SIZE;
  } while (idx != start);
  return NULL;
}

static void cache_put(Cache* c, const char* key, const int32_t* ids, int count) {
  uint32_t oldest_idx = 0;
  uint32_t oldest_age = c->ages[0];
  int empty_slot = -1;

  uint32_t i;
  for (i = 0; i < CACHE_SIZE; i++) {
    if (c->keys[i][0] == '\0') {
      empty_slot = (int)i;
      break;
    }
    if (c->ages[i] < oldest_age) {
      oldest_age = c->ages[i];
      oldest_idx = i;
    }
  }

  uint32_t slot = (empty_slot >= 0) ? (uint32_t)empty_slot : oldest_idx;
  my_strncpy(c->keys[slot], key, MAX_WORD_LEN - 1);
  c->keys[slot][MAX_WORD_LEN - 1] = '\0';
  my_memcpy(c->ids[slot], ids, count * sizeof(int32_t));
  c->id_counts[slot] = count;
  c->ages[slot] = c->next_age++;
}

/* ── Parse vocab JSON ────────────────────────────────────────────────────── */
static int parse_vocab(const char* json, int json_len) {
  vocab_init(&g_vocab);
  g_vocab_count = 0;

  const char* p = json;
  const char* end = json + json_len;

  p = json_skip_ws(p, end);
  if (p >= end || *p != '{') return -1;
  p++;

  int first = 1;
  while (p < end) {
    p = json_skip_ws(p, end);
    if (*p == '}') break;

    if (!first) {
      if (*p != ',') return -1;
      p++;
      p = json_skip_ws(p, end);
    }
    first = 0;

    char key[MAX_TOKEN_LEN];
    p = json_parse_string(p, end, key, sizeof(key));
    if (!p) return -1;

    p = json_skip_ws(p, end);
    if (p >= end || *p != ':') return -1;
    p++;

    int32_t val;
    p = json_parse_int(p, end, &val);
    if (!p) return -1;

    if (vocab_insert(&g_vocab, key, val) >= 0) {
      if (val < MAX_VOCAB_SIZE) {
        /* Find the slot we just inserted into */
        int slot = vocab_lookup(&g_vocab, key);
        if (slot >= 0) {
          g_reverse_vocab[val] = g_vocab.keys[slot];
          if (g_vocab_count <= val) g_vocab_count = val + 1;
        }
      }
    }
  }

  return 0;
}

/* ── Parse merges JSON ───────────────────────────────────────────────────── */
static int parse_merges(const char* json, int json_len) {
  merges_init(&g_merges);

  const char* p = json;
  const char* end = json + json_len;

  p = json_skip_ws(p, end);
  if (p >= end || *p != '{') return -1;
  p++;

  int first = 1;
  while (p < end) {
    p = json_skip_ws(p, end);
    if (*p == '}') break;

    if (!first) {
      if (*p != ',') return -1;
      p++;
      p = json_skip_ws(p, end);
    }
    first = 0;

    char key[MAX_TOKEN_LEN * 2 + 2];
    p = json_parse_string(p, end, key, sizeof(key));
    if (!p) return -1;

    p = json_skip_ws(p, end);
    if (p >= end || *p != ':') return -1;
    p++;

    int32_t val;
    p = json_parse_int(p, end, &val);
    if (!p) return -1;

    merges_insert(&g_merges, key, val);
  }

  return 0;
}

/* ── Encode a single codepoint to a token string (for building initial tokens) ── */
static int cp_to_token_string(uint16_t cp, char* out, int out_len) {
  /* The token string in the vocab is the UTF-8 encoding of the unicode codepoint */
  return cp_to_utf8(cp, out, out_len);
}

/* ── WASM exports ────────────────────────────────────────────────────────── */
/*
 * We need to access the imported linear memory. With -Wl,--import-memory,
 * the memory is imported as "env.memory". We declare it as an extern pointer.
 */
extern uint8_t __memory_base;

__attribute__((export_name("bpe_init")))
int32_t bpe_init(int32_t vocab_ptr, int32_t vocab_len,
                 int32_t merges_ptr, int32_t merges_len) {
  uint8_t* mem = &__memory_base;

  if (parse_vocab((const char*)(mem + vocab_ptr), vocab_len) < 0) {
    return -1;
  }

  if (parse_merges((const char*)(mem + merges_ptr), merges_len) < 0) {
    return -1;
  }

  init_byte_to_unicode();
  init_unicode_to_byte();
  cache_init(&g_cache);

  g_initialized = 1;
  return 0;
}

__attribute__((export_name("bpe_count")))
uint32_t bpe_count(int32_t handle, int32_t text_ptr, int32_t text_len) {
  (void)handle;
  if (!g_initialized || !text_len) return 0;

  uint8_t* mem = &__memory_base;
  const char* text = (const char*)(mem + text_ptr);

  int offsets[512];
  int lengths[512];
  int n_chunks = pretokenize(text, text_len, offsets, lengths, 512);

  uint32_t total = 0;
  char word_buf[MAX_WORD_LEN];
  int32_t ids[MAX_TOKENS];

  int c;
  for (c = 0; c < n_chunks; c++) {
    if (lengths[c] == 0) continue;

    int wlen = lengths[c] < MAX_WORD_LEN - 1 ? lengths[c] : MAX_WORD_LEN - 1;
    my_memcpy(word_buf, text + offsets[c], wlen);
    word_buf[wlen] = '\0';

    int cached_count;
    const int32_t* cached = cache_get(&g_cache, word_buf, &cached_count);
    if (cached) {
      total += (uint32_t)cached_count;
      continue;
    }

    uint16_t cps[MAX_WORD_LEN];
    int n_cps = word_to_byte_chars(word_buf, wlen, cps, MAX_WORD_LEN);

    char tokens[MAX_WORD_LEN][MAX_TOKEN_LEN];
    int i;
    for (i = 0; i < n_cps; i++) {
      cp_to_token_string(cps[i], tokens[i], MAX_TOKEN_LEN);
    }

    int n_tokens = bpe_merge(tokens, n_cps);

    int n_ids = 0;
    for (i = 0; i < n_tokens && n_ids < MAX_TOKENS; i++) {
      int slot = vocab_lookup(&g_vocab, tokens[i]);
      if (slot >= 0) {
        ids[n_ids++] = g_vocab.vals[slot];
      } else {
        int fallback = 0;
        int j;
        for (j = 0; tokens[i][j] && n_ids < MAX_TOKENS; j++) {
          char ch[2] = {tokens[i][j], '\0'};
          int ch_slot = vocab_lookup(&g_vocab, ch);
          if (ch_slot >= 0) {
            ids[n_ids++] = g_vocab.vals[ch_slot];
            fallback = 1;
          }
        }
        if (!fallback && n_ids < MAX_TOKENS) {
          ids[n_ids++] = 0;
        }
      }
    }

    cache_put(&g_cache, word_buf, ids, n_ids);
    total += (uint32_t)n_ids;
  }

  return total;
}

__attribute__((export_name("bpe_encode")))
uint32_t bpe_encode(int32_t handle, int32_t text_ptr, int32_t text_len,
                    int32_t out_ids_ptr, int32_t out_cap) {
  (void)handle;
  if (!g_initialized || !text_len || out_cap <= 0) return 0;

  uint8_t* mem = &__memory_base;
  const char* text = (const char*)(mem + text_ptr);
  int32_t* out_ids = (int32_t*)(mem + out_ids_ptr);

  int offsets[512];
  int lengths[512];
  int n_chunks = pretokenize(text, text_len, offsets, lengths, 512);

  uint32_t total_written = 0;
  char word_buf[MAX_WORD_LEN];
  int32_t ids[MAX_TOKENS];

  int c;
  for (c = 0; c < n_chunks && total_written < (uint32_t)out_cap; c++) {
    if (lengths[c] == 0) continue;

    int wlen = lengths[c] < MAX_WORD_LEN - 1 ? lengths[c] : MAX_WORD_LEN - 1;
    my_memcpy(word_buf, text + offsets[c], wlen);
    word_buf[wlen] = '\0';

    int cached_count;
    const int32_t* cached = cache_get(&g_cache, word_buf, &cached_count);
    if (cached) {
      int to_copy = cached_count;
      if (total_written + to_copy > (uint32_t)out_cap) to_copy = out_cap - total_written;
      my_memcpy(&out_ids[total_written], cached, to_copy * sizeof(int32_t));
      total_written += to_copy;
      continue;
    }

    uint16_t cps[MAX_WORD_LEN];
    int n_cps = word_to_byte_chars(word_buf, wlen, cps, MAX_WORD_LEN);

    char tokens[MAX_WORD_LEN][MAX_TOKEN_LEN];
    int i;
    for (i = 0; i < n_cps; i++) {
      cp_to_token_string(cps[i], tokens[i], MAX_TOKEN_LEN);
    }

    int n_tokens = bpe_merge(tokens, n_cps);

    int n_ids = 0;
    for (i = 0; i < n_tokens && n_ids < MAX_TOKENS; i++) {
      int slot = vocab_lookup(&g_vocab, tokens[i]);
      if (slot >= 0) {
        ids[n_ids++] = g_vocab.vals[slot];
      } else {
        int fallback = 0;
        int j;
        for (j = 0; tokens[i][j] && n_ids < MAX_TOKENS; j++) {
          char ch[2] = {tokens[i][j], '\0'};
          int ch_slot = vocab_lookup(&g_vocab, ch);
          if (ch_slot >= 0) {
            ids[n_ids++] = g_vocab.vals[ch_slot];
            fallback = 1;
          }
        }
        if (!fallback && n_ids < MAX_TOKENS) {
          ids[n_ids++] = 0;
        }
      }
    }

    cache_put(&g_cache, word_buf, ids, n_ids);

    int to_copy = n_ids;
    if (total_written + to_copy > (uint32_t)out_cap) to_copy = out_cap - total_written;
    my_memcpy(&out_ids[total_written], ids, to_copy * sizeof(int32_t));
    total_written += to_copy;
  }

  return total_written;
}

__attribute__((export_name("bpe_decode")))
uint32_t bpe_decode(int32_t handle, int32_t id,
                    int32_t out_text_ptr, int32_t out_cap) {
  (void)handle;
  if (!g_initialized || out_cap <= 0) return 0;

  uint8_t* mem = &__memory_base;
  char* out_text = (char*)(mem + out_text_ptr);

  if (id < 0 || id >= g_vocab_count) return 0;

  const char* token = g_reverse_vocab[id];
  if (!token) return 0;

  init_unicode_to_byte();
  int written = 0;
  const char* p = token;
  while (*p && written < out_cap - 1) {
    uint8_t c = (uint8_t)*p;
    if (c < 0x80) {
      int8_t b = unicode_to_byte[c];
      if (b >= 0) {
        out_text[written++] = (char)b;
      } else {
        out_text[written++] = (char)c;
      }
      p++;
    } else if ((c & 0xE0) == 0xC0) {
      if (p[1]) {
        uint16_t cp = ((uint16_t)(c & 0x1F) << 6) | ((uint16_t)((uint8_t)p[1] & 0x3F));
        int8_t b = unicode_to_byte[cp];
        if (b >= 0) {
          out_text[written++] = (char)b;
        } else {
          out_text[written++] = (char)c;
          out_text[written++] = (char)(uint8_t)p[1];
        }
        p += 2;
      } else break;
    } else if ((c & 0xF0) == 0xE0) {
      if (p[1] && p[2]) {
        uint16_t cp = ((uint16_t)(c & 0x0F) << 12) |
                      ((uint16_t)((uint8_t)p[1] & 0x3F) << 6) |
                      ((uint16_t)((uint8_t)p[2] & 0x3F));
        int8_t b = unicode_to_byte[cp];
        if (b >= 0) {
          out_text[written++] = (char)b;
        } else {
          out_text[written++] = (char)c;
          out_text[written++] = (char)(uint8_t)p[1];
          out_text[written++] = (char)(uint8_t)p[2];
        }
        p += 3;
      } else break;
    } else {
      out_text[written++] = (char)c;
      p++;
    }
  }
  out_text[written] = '\0';
  return written;
}

__attribute__((export_name("bpe_free")))
void bpe_free(int32_t handle) {
  (void)handle;
  g_initialized = 0;
}
