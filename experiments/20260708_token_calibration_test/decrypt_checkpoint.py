"""
Decrypt and analyze a checkpoint file for token calibration.
Uses the same crypto as opencode's request-diff.ts:
  key = sha256(projectID + ":" + sessionID + ":opencode-diff-baseline-v1")
  AES-256-GCM with 12-byte IV prepended to ciphertext
"""
import hashlib
import json
import os
import sys
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("pip install cryptography")
    sys.exit(1)

CHECKPOINT_DIR = Path(".opencode/data/log/.checkpoints")

def find_latest_build_checkpoint():
    files = []
    for f in CHECKPOINT_DIR.glob("*_build_*.enc"):
        files.append((f, f.stat().st_mtime))
    files.sort(key=lambda x: x[1], reverse=True)
    return files[0][0] if files else None

def parse_ids(filename: str):
    """Extract sessionID from filename like provider_model_agent_sessionID.enc"""
    name = filename.replace(".enc", "")
    # Session ID starts after the agent name — find "ses_" prefix
    idx = name.index("ses_")
    session_id = name[idx:]  # ses_0bea8f107ffe77jmf4GZg1Tlft
    before = name[:idx].rstrip("_")  # opencode-go_mimo-v2.5-pro_build
    parts = before.split("_")
    provider = parts[0]
    return session_id, provider

def decrypt_checkpoint(filepath: Path, project_id: str, session_id: str) -> dict:
    material = f"{project_id}:{session_id}:opencode-diff-baseline-v1"
    key_bytes = hashlib.sha256(material.encode()).digest()
    
    data = filepath.read_bytes()
    iv = data[:12]
    ciphertext = data[12:]
    
    aesgcm = AESGCM(key_bytes)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))

def get_project_id():
    """Read project ID from opencode database."""
    import sqlite3
    db_path = Path(".opencode/data/opencode.db")
    if not db_path.exists():
        return "opencode"
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("SELECT id FROM project LIMIT 1")
    row = cur.fetchone()
    conn.close()
    return row[0] if row else "opencode"

def main():
    ckpt = find_latest_build_checkpoint()
    if not ckpt:
        print("No build checkpoints found")
        return
    
    print(f"Checkpoint: {ckpt.name}")
    
    name = ckpt.stem  # e.g. opencode-go_mimo-v2.5-pro_build_ses_0bea8f107ffe77jmf4GZg1Tlft
    idx = name.index("ses_")
    session_id = name[idx:]  # ses_0bea8f107ffe77jmf4GZg1Tlft
    before = name[:idx].rstrip("_")
    parts = before.split("_")
    provider = parts[0]
    model = "_".join(parts[1:])
    
    project_id = get_project_id()
    print(f"Provider: {provider}, Model: {model}, Session: {session_id}")
    print(f"ProjectID: {project_id}")
    
    data = decrypt_checkpoint(ckpt, project_id, session_id)
    
    print(f"Agent: {data.get('agent')}")
    print(f"Turn: {data.get('turn')}")
    print(f"Messages: {len(data.get('messages', []))}")
    
    # System prompt
    sys_prompt = "\n".join(data.get("systemPrompt", []))
    print(f"\nSystem prompt: {len(sys_prompt)} chars, {len(sys_prompt)//4} tokens (chars/4)")
    
    # Messages
    messages = data.get("messages", [])
    total_chars = len(sys_prompt)
    
    print(f"\nMessages breakdown:")
    for i, msg in enumerate(messages):
        role = msg.get("role", "?")
        content = msg.get("content", "")
        if isinstance(content, list):
            text = "".join(p.get("text", "") for p in content if p.get("type") == "text")
        elif isinstance(content, str):
            text = content
        else:
            text = str(content)
        total_chars += len(text)
        print(f"  [{i:2d}] {role:10s}: {len(text):>8} chars")
    
    print(f"\nTotal: {total_chars} chars, {total_chars//4} tokens (chars/4)")
    
    # Save for Python test
    out = {
        "systemPrompt": sys_prompt,
        "messages": [
            {
                "role": m.get("role"),
                "content": (
                    "".join(p.get("text", "") for p in m["content"] if p.get("type") == "text")
                    if isinstance(m.get("content"), list)
                    else str(m.get("content", ""))
                ),
            }
            for m in messages
        ],
    }
    out_path = Path("experiments/20260708_token_calibration_test/checkpoint_sample.json")
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"\nSaved: {out_path}")

if __name__ == "__main__":
    main()
