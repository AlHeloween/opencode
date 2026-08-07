"""Add tag: GN fields to gate definitions in core_schemas.yaml if missing."""
from pathlib import Path

SCHEMAS = Path(__file__).resolve().parents[1] / "core_schemas.yaml"

def main():
    text = SCHEMAS.read_text()
    added = 0
    for i in range(1, 10):
        marker = f"  G{i}:\n"
        idx = text.find(marker)
        if idx < 0:
            print(f"  G{i}: NOT FOUND")
            continue
        # Check if tag already exists right after G{N}:
        after = text[idx + len(marker):idx + len(marker) + 20]
        if "tag:" in after:
            print(f"  G{i}: already tagged")
            continue
        # Insert tag line
        text = text.replace(marker, f"  G{i}:\n    tag: G{i}\n", 1)
        added += 1
        print(f"  G{i}: tag added")
    
    if added:
        SCHEMAS.write_text(text, encoding="utf-8", newline="\n")
        print(f"Added {added} tags")
    else:
        print("All gates already tagged")

if __name__ == "__main__":
    main()
