# WASM Build — Tokenizer only (C → WASM)
# Diff and JSON repair now use Rust crate WASM (see external/justinbarclay-diff, external/json-repair)

CC ?= clang
WASM_OPT ?= wasm-opt

OUT_DIR = pkg

TOKENIZER_SRC = src/tokenizer.c
TOKENIZER_WASM = $(OUT_DIR)/tokenizer.wasm

CFLAGS = --target=wasm32 -Oz -flto -Wall -Wextra
TOKENIZER_LDFLAGS = -Wl,--no-entry -Wl,--export=bpe_init -Wl,--export=bpe_count \
          -Wl,--export=bpe_encode -Wl,--export=bpe_decode -Wl,--export=bpe_free \
          -Wl,--import-memory -Wl,--import-undefined -Wl,--allow-undefined \
          -Wl,--export-dynamic -nostdlib

.PHONY: all clean tokenizer

all: tokenizer
tokenizer: $(TOKENIZER_WASM)

$(TOKENIZER_WASM): $(TOKENIZER_SRC) | $(OUT_DIR)
	$(CC) $(CFLAGS) $(TOKENIZER_LDFLAGS) -o $@ $<
	@if command -v $(WASM_OPT) >/dev/null 2>&1; then \
		$(WASM_OPT) -Oz -o $@ $@; \
	fi

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

clean:
	rm -rf $(OUT_DIR)
