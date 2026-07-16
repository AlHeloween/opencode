# WASM Build — Tokenizer only (C → WASM)
# Diff and JSON repair now use Rust crate WASM (see external/justinbarclay-diff, external/json-repair)

CC ?= clang
WASM_OPT ?= wasm-opt

OUT_DIR = pkg

TOKENIZER_SRC = src/tokenizer.c
TOKENIZER_WASM = $(OUT_DIR)/tokenizer.wasm
PATH_VALIDATOR_SRC = src/path_validator.c
PATH_VALIDATOR_WASM = $(OUT_DIR)/path_validator.wasm

# Prefer LLVM clang on Windows (MSVC clang.cmd is not a full wasm toolchain).
ifeq ($(OS),Windows_NT)
  ifneq ($(wildcard C:/Program\ Files/LLVM/bin/clang.exe),)
    CC := C:/Program Files/LLVM/bin/clang.exe
  endif
endif

CFLAGS = --target=wasm32 -Oz -flto -Wall -Wextra
TOKENIZER_LDFLAGS = -Wl,--no-entry -Wl,--export=bpe_init -Wl,--export=bpe_count \
          -Wl,--export=bpe_encode -Wl,--export=bpe_decode -Wl,--export=bpe_free \
          -Wl,--import-memory -Wl,--import-undefined -Wl,--allow-undefined \
          -Wl,--export-dynamic -nostdlib
PATH_VALIDATOR_LDFLAGS = -Wl,--no-entry \
          -Wl,--export=pv_validate -Wl,--export=pv_version \
          -Wl,--import-memory -Wl,--allow-undefined \
          -nostdlib

.PHONY: all clean tokenizer path_validator

all: tokenizer path_validator
tokenizer: $(TOKENIZER_WASM)
path_validator: $(PATH_VALIDATOR_WASM)

$(TOKENIZER_WASM): $(TOKENIZER_SRC) | $(OUT_DIR)
	$(CC) $(CFLAGS) $(TOKENIZER_LDFLAGS) -o $@ $<
	@if command -v $(WASM_OPT) >/dev/null 2>&1; then \
		$(WASM_OPT) -Oz -o $@ $@; \
	fi

$(PATH_VALIDATOR_WASM): $(PATH_VALIDATOR_SRC) | $(OUT_DIR)
	"$(CC)" $(CFLAGS) $(PATH_VALIDATOR_LDFLAGS) -o $@ $<
	@if command -v $(WASM_OPT) >/dev/null 2>&1; then \
		$(WASM_OPT) -Oz -o $@ $@; \
	fi

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

clean:
	rm -rf $(OUT_DIR)
