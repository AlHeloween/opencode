"""Is there a dataset for a small drift detector — and, more importantly, are its LABELS honest?

The owner's idea (2026-09-22): «мы можем обучить мелкую неронку, которая на gpu будет отлично
палить». The GPU is not the constraint; labels are. A model trained on the `prev-md5` field would
learn the WRITER's habit, not the event — the same trap as grading ourselves — so the label must be
an event that something other than that writer produced.

The candidate measured here: the owner's own intervention. When the agent has quietly left the point,
the owner's next message is far from what the agent just said; when the agent is on track, the
owner's message continues it. That is an outside signal, it is already in the database, and it is
measurable: embed (last assistant message, following user message) and look at the distance.

What this prints:
  - how many owner-intervention pairs exist at all (the dataset size ceiling);
  - the distance distribution, so a threshold is chosen from data rather than declared;
  - the pairs that fire, with the owner's own words — because a label nobody can read is a guess.

Run: python experiments/2026-09-22_drift-labels/probe.py [max_pairs]
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / ".opencode" / "data" / "opencode.db"


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 600
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        """
        SELECT m.session_id, m.id, m.data, (
            SELECT p.data FROM part p
            WHERE p.message_id = m.id AND p.type = 'text'
            ORDER BY p.id LIMIT 1
        )
        FROM message m
        ORDER BY m.id
        """
    ).fetchall()
    con.close()

    messages = []
    for session_id, message_id, data, part in rows:
        try:
            info = json.loads(data)
        except Exception:
            continue
        text = ""
        if part:
            try:
                text = (json.loads(part).get("text") or "").strip()
            except Exception:
                text = ""
        if not text:
            continue
        messages.append({"session": session_id, "id": message_id, "role": info.get("role"), "text": text})

    pairs = []
    for index in range(1, len(messages)):
        previous, current = messages[index - 1], messages[index]
        if previous["role"] == "assistant" and current["role"] == "user":
            if len(previous["text"]) < 40 or len(current["text"]) < 20:
                continue
            pairs.append((previous, current))
    pairs = pairs[-limit:]
    print(f"messages with text: {len(messages)} · owner-intervention pairs (assistant → user): {len(pairs)}")
    if len(pairs) < 20:
        print("too few pairs to say anything about a dataset")
        return 1

    from sentence_transformers import SentenceTransformer  # type: ignore

    model = SentenceTransformer("BAAI/bge-m3", device="cuda")
    # 4 GB of VRAM is the real constraint here, not the model: a batch of full assistant messages
    # asked for 5.66 GiB of attention mask alone. Truncating to 512 tokens and batching by 4 keeps
    # the run on the GPU - which is where it belongs - instead of falling back to the CPU.
    model.max_seq_length = 512
    model.half()
    agent_vectors = model.encode(
        [a["text"] for a, _ in pairs], normalize_embeddings=True, show_progress_bar=False, batch_size=4
    )
    owner_vectors = model.encode(
        [u["text"] for _, u in pairs], normalize_embeddings=True, show_progress_bar=False, batch_size=4
    )

    scored = []
    for index, (agent, owner) in enumerate(pairs):
        dot = float(sum(x * y for x, y in zip(agent_vectors[index], owner_vectors[index])))
        scored.append((1.0 - dot, agent, owner))
    values = sorted(value for value, _, _ in scored)
    median = values[len(values) // 2]
    print(
        f"\ndistance agent→owner: min {values[0]:.3f} / median {median:.3f} / "
        f"p90 {values[int(len(values) * 0.9)]:.3f} / max {values[-1]:.3f}"
    )
    for threshold in (0.4, 0.5, 0.6, 0.7):
        hits = sum(1 for value in values if value >= threshold)
        print(f"  Δ >= {threshold:<4} → {hits:>3} of {len(values)} ({100.0 * hits / len(values):.1f}%)"
              f"{'   ← candidate label set' if 0.02 <= hits / len(values) <= 0.25 else ''}")

    print("\nthe widest separations, with the owner's own words (a label must be readable):")
    for value, agent, owner in sorted(scored, key=lambda row: row[0], reverse=True)[:6]:
        print(f"  Δ={value:.3f}")
        print(f"    agent: {agent['text'][:110].replace(chr(10), ' ')}")
        print(f"    owner: {owner['text'][:110].replace(chr(10), ' ')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
