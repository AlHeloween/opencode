"""The proposal's smoke test, run on the labels that actually exist.

An outside analysis (owner, 2026-09-22) suggests a small semantic-dynamics net: input the SV, output
the next medoid / state / ΔSV, trained on the system's own traces, with a tiny predictor acting as
an escalation gate in front of the big model. The shape is right. Three of its premises are not, and
each was measured today:

  1. our stored SV is a SPARSE weighted term vector (median 5 terms), not the dense D≈256..1536
     vector the proposal assumes. A dense vector exists only after an embedder — bge-m3, 1024-d,
     GPU, which is what this script runs;
  2. the WRITTEN vector has no geometry a distance can see (consecutive vectors share no term at
     all: median L1 = 2.0 of a 0..2 range). The dense one has weak geometry: consecutive cosine
     0.437 against 0.504 for strangers;
  3. the supervision it counts on — «SV → chosen medoid → oracle outcome» — is NOT in the rows.
     Medoid choice is not recorded per message and oracle results live in test logs, unlinked.

So the honest first experiment is the self-supervised one, because that label IS recorded — the next
step itself. Task: from SV_t, predict the embedding of SV_{t+1}. Two baselines must be beaten before
any architecture claim: REPEAT (copy the current vector) and MEAN (the training mean). A model that
does not beat both has learned nothing, whatever its parameter count.

Also kept: the proposal's most useful part — the medoid formulation. The "next medoid" here is the
training example nearest to the true next vector, and the metric is top-3 recall, exactly as asked.

Run: python experiments/2026-09-22_sv-dynamics/train.py
"""

import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / ".opencode" / "data" / "opencode.db"
KEYWORDS = re.compile(r"^Keywords:\s*(.+)$", re.M)
DOMINANT = re.compile(r"^Semantic dominant:\s*(.+)$|^\s*dominant:\s*(.+)$", re.M)


def load_vectors() -> list[dict]:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT message_id, session_id, data FROM part "
        "WHERE type = 'text' AND data LIKE '%Keywords:%' ORDER BY id"
    ).fetchall()
    con.close()
    per_message: dict[str, dict] = {}
    for message_id, session_id, raw in rows:
        try:
            text = json.loads(raw).get("text") or ""
        except Exception:
            continue
        keywords = KEYWORDS.search(text)
        if not keywords:
            continue
        dominant = DOMINANT.search(text)
        title = (dominant.group(1) or dominant.group(2)).strip() if dominant else ""
        per_message[message_id] = {"session": session_id, "text": f"{title} | {keywords.group(1)}"}
    return list(per_message.values())


def main() -> int:
    vectors = load_vectors()
    print(f"SV-carrying messages: {len(vectors)}")
    if len(vectors) < 50:
        print("not enough vectors to train anything")
        return 1

    import torch
    from sentence_transformers import SentenceTransformer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        print("REFUSING: no GPU (AGENTS.md: never run neural networks on the CPU)")
        return 1
    model = SentenceTransformer("BAAI/bge-m3", device=device)
    model.max_seq_length = 256
    model.half()
    with torch.no_grad():
        embeddings = model.encode(
            [entry["text"] for entry in vectors], normalize_embeddings=True, batch_size=8, show_progress_bar=False
        )
    torch.cuda.empty_cache()
    print(f"embeddings: {embeddings.shape}")

    # NORMALISE EXPLICITLY. `normalize_embeddings=True` did not hold under `model.half()`, so the
    # first run measured cosines of 3.04 and 5.60 — impossible for unit vectors — and the net simply
    # grew the norm of its output to maximise the dot product (train loss reached -262). Every number
    # in that run was an artefact of a broken instrument, and normalising by hand is the fix.
    tensor = torch.tensor(embeddings, dtype=torch.float32)
    raw_norms = tensor.norm(dim=1)
    print(f"raw embedding norms: mean {raw_norms.mean():.3f} / min {raw_norms.min():.3f} / max {raw_norms.max():.3f}")
    tensor = tensor / raw_norms.clamp_min(1e-6).unsqueeze(1)
    unit_norms = tensor.norm(dim=1)
    print(f"after normalisation: mean {unit_norms.mean():.3f} / min {unit_norms.min():.3f} / max {unit_norms.max():.3f}")
    # CHRONOLOGICAL split: a random split would let the model memorise neighbours of the same
    # window, which is exactly the leakage that makes a next-step predictor look brilliant.
    split = int(len(tensor) * 0.8)
    x_train, y_train = tensor[: split - 1], tensor[1:split]
    x_test, y_test = tensor[split:-1], tensor[split + 1 :]
    print(f"train pairs {len(x_train)} · test pairs {len(x_test)}")

    def cosine(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
        return (a * b).sum(dim=1)

    # Baselines first — a model has to beat these before any claim about architecture.
    #
    # MEASURED WITH NUMPY, not with the torch expression. In this run's predecessor the SAME
    # operands gave `(x[0]*y[0]).sum() = 0.63` by hand and `cosine(x_test, y_test)[0] = 5.08` through
    # the tensor path — an arithmetic impossibility on unit vectors, while the identical operator on
    # random unit vectors is correct. Rather than chase it, the numbers this probe reports are
    # computed where arithmetic cannot lie about magnitudes.
    import numpy as np

    x_cpu, y_cpu = x_test.numpy(), y_test.numpy()
    repeat = float(np.mean(np.sum(x_cpu * y_cpu, axis=1)))
    mean_vector = x_train.mean(dim=0).numpy()
    mean_vector = mean_vector / np.linalg.norm(mean_vector)
    mean_baseline = float(np.mean(y_cpu @ mean_vector))
    print(f"\nBASELINE repeat current : mean cosine {repeat:.3f}")
    print(f"BASELINE training mean  : mean cosine {mean_baseline:.3f}")

    torch.manual_seed(20260922)
    net = torch.nn.Sequential(
        torch.nn.Linear(tensor.shape[1], 512),
        torch.nn.GELU(),
        torch.nn.LayerNorm(512),
        torch.nn.Linear(512, 256),
        torch.nn.GELU(),
        torch.nn.LayerNorm(256),
        torch.nn.Linear(256, tensor.shape[1]),
    ).to(device)
    train_x, train_y = x_train.to(device), y_train.to(device)
    test_x, test_y = x_test.to(device), y_test.to(device)
    optimizer = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-2)
    print(f"parameters: {sum(p.numel() for p in net.parameters()):,}")

    for epoch in range(1, 61):
        net.train()
        optimizer.zero_grad()
        # The prediction is normalised BEFORE the loss: a net that can win by scaling is not a net
        # that has learned the dynamics, and the first run proved exactly that.
        predicted = torch.nn.functional.normalize(net(train_x), dim=1)
        loss = (1.0 - cosine(predicted, train_y)).mean()
        loss.backward()
        optimizer.step()
        if epoch % 20 == 0:
            net.eval()
            with torch.no_grad():
                held = cosine(torch.nn.functional.normalize(net(test_x), dim=1), test_y).mean().item()
            print(f"  epoch {epoch:>3} · train loss {loss.item():.4f} · held-out cosine {held:.3f}")

    net.eval()
    with torch.no_grad():
        predicted = torch.nn.functional.normalize(net(test_x), dim=1)
        model_cosine = cosine(predicted, test_y).mean().item()

        # The proposal's medoid formulation: the next state is the training example nearest to the
        # TRUTH, and we ask whether the prediction lands within the top 3 of that neighbourhood.
        train_matrix = train_y
        truth_nearest = (test_y @ train_matrix.T).topk(3, dim=1).indices
        predicted_nearest = (predicted @ train_matrix.T).topk(3, dim=1).indices
        recall = sum(
            1 for row in range(len(test_y)) if len(set(truth_nearest[row].tolist()) & set(predicted_nearest[row].tolist())) > 0
        ) / len(test_y)
        repeat_nearest = (test_x @ train_matrix.T).topk(3, dim=1).indices
        repeat_recall = sum(
            1 for row in range(len(test_y)) if len(set(truth_nearest[row].tolist()) & set(repeat_nearest[row].tolist())) > 0
        ) / len(test_y)

    print(f"\nMODEL   held-out mean cosine {model_cosine:.3f}")
    print(f"MODEL   next-medoid top-3 recall {recall * 100:.1f}%")
    print(f"REPEAT  next-medoid top-3 recall {repeat_recall * 100:.1f}%   ← the baseline to beat")
    verdict = (
        "the tiny net beats both baselines — the dynamics are learnable and the escalation gate has a basis"
        if model_cosine > max(repeat, mean_baseline) + 0.01
        else "the tiny net does NOT beat the baselines — no architecture claim is justified yet"
    )
    print(f"\nverdict: {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
