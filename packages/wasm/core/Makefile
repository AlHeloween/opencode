# WASM Build — path_validator only (C → WASM)
# Tokenizers removed: use symbols/4 + 10k overhead (overflow.ts). Diff/JSON repair = Rust crates.

CC ?= clang
WASM_OPT ?= wasm-opt

OUT_DIR = pkg

PATH_VALIDATOR_SRC = src/path_validator.c
PATH_VALIDATOR_WASM = $(OUT_DIR)/path_validator.wasm

# Prefer LLVM clang on Windows (MSVC clang.cmd is not a full wasm toolchain).
ifeq ($(OS),Windows_NT)
  ifneq ($(wildcard C:/Program\ Files/LLVM/bin/clang.exe),)
    CC := C:/Program Files/LLVM/bin/clang.exe
  endif
endif

CFLAGS = --target=wasm32 -Oz -flto -Wall -Wextra
PATH_VALIDATOR_LDFLAGS = -Wl,--no-entry \
          -Wl,--export=pv_validate -Wl,--export=pv_version \
          -Wl,--import-memory -Wl,--allow-undefined \
          -nostdlib

.PHONY: all clean path_validator

all: path_validator
path_validator: $(PATH_VALIDATOR_WASM)

$(PATH_VALIDATOR_WASM): $(PATH_VALIDATOR_SRC) | $(OUT_DIR)
	"$(CC)" $(CFLAGS) $(PATH_VALIDATOR_LDFLAGS) -o $@ $<
	@if command -v $(WASM_OPT) >/dev/null 2>&1; then \
		$(WASM_OPT) -Oz -o $@ $@; \
	fi

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

clean:
	rm -rf $(OUT_DIR)
