"""A/B pair builder (t70 chunk 1): 10 pairs from AB_CTX.json windows.

Arm A replay = full window text. Arm B replay = window minus marker lines +
a fixed erratum paragraph (exactly what P1 would put on the wire).
Writes AB_PAIRS.json. No network. READ-ONLY over the DB (none read here).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL = {"provider": "streamlake-vanchin", "model": "deepseek-v4-flash"}

# (kind, part id, window span, cut_sub, score_sub, erratum, continuation prompt)
PAIRS = [
    ("cjk", "prt_116ebe244001N28WWqU75jhICw", (183, 195),
     "非常", "非常",
     "CJK-вставки (非常, 因为) — артефакты генерации, не термины; ту же мысль пиши по-русски.",
     "Продолжи разбор: какой следующий шаг для проверки мелкого текста? Два-три предложения по-русски."),
    ("cjk", "prt_116ebe244001N28WWqU75jhICw", (211, 223),
     "在 нодах", "在 нодах",
     "CJK-вставка 在 — артефакт; пиши по-русски.",
     "Продолжи: что с текстом в нодах диаграммы? Два-три предложения по-русски."),
    ("cjk", "prt_0e3dd7878001Fuio11duvo8KcL", (1034, 1046),
     "在 G8", "在 G8",
     "CJK-вставка 在 — артефакт; пиши по-русски.",
     "Продолжи разбор source.py: что сократить следующим? Два-три предложения по-русски."),
    ("cjk", "prt_0e3dd7878001Fuio11duvo8KcL", (1077, 1089),
     "和 почему", "和 почему",
     "CJK-вставка 和 — артефакт; пиши по-русски.",
     "Продолжи: куда вставить reward function и почему? Два-три предложения по-русски."),
    ("cjk", "prt_0e3dd7878001Fuio11duvo8KcL", (1104, 1116),
     "在 машинном", "在 машинном",
     "CJK-вставки (在, 这是) — артефакты; пиши по-русски.",
     "Продолжи: что такое reward function в этом кернеле? Два-три предложения по-русски."),
    ("cjk", "prt_1172b9c290014NJj033hi5G7Om", (978, 990),
     "更长", "更长",
     "CJK-вставка 更长 — артефакт; пиши по-русски.",
     "Продолжи: какой размер взять для рендера цепочки? Два-три предложения по-русски."),
    ("claim", "prt_13471853e001nI6GpG95aCmZ1O", (40, 60),
     "28 unique", "28",
     "MEDLINE бесплатен через PubMed; платных источников 27, не 28.",
     "How many paid sources are on the list? Answer with the number and one line why."),
    ("claim", "prt_11f5fa3be001cgHu4RPPi9pyYm", (19, 27),
     "exit code 6?|exit 6:", "exit 6",
     "response.failed мапится на exit 4 (server-side failure); exit 6 — только deadline/timeout клиента.",
     "What exit code does response.failed map to? Answer briefly."),
    ("claim", "prt_1235aee380010QQUgUGEJ9DIIZ", (50, 62),
     "30 cap", "30",
     "Лимит — 80 tool calls по envelope плана, не 30.",
     "How many tool calls are left in the budget? Answer briefly."),
    ("claim", "prt_13800abef0014ssLYpNatcVbU8", (20, 32),
     "WrForum-trusted", "WrForum-trusted",
     "Fossil forum capability '4' — это ModForum (moderator), не WrForum-trusted.",
     "What does fossil forum capability '4' mean? Answer briefly."),
]


def main() -> None:
    ctx = json.loads((HERE / "AB_CTX.json").read_text(encoding="utf-8"))
    by_id_span = {}
    for w in ctx["cjk_windows"]:
        for win in w["windows"]:
            by_id_span[(w["id"], tuple(win["span"]))] = win["text"]
    for pid, wins in ctx["claim_windows"].items():
        for win in wins:
            by_id_span[(pid, tuple(win["span"]))] = win["text"]
    # exit pair window (19,27) is not in AB_CTX: read full text from DB
    import sqlite3
    db = Path(r"D:\zPython\opencode\.opencode\data\opencode.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    row = con.execute(
        "SELECT data FROM part WHERE id='prt_11f5fa3be001cgHu4RPPi9pyYm'").fetchone()
    con.close()
    full = json.loads(row[0]).get("text", "").splitlines()
    by_id_span[("prt_11f5fa3be001cgHu4RPPi9pyYm", (19, 27))] = "\n".join(full[18:27])
    pairs = []
    for i, (kind, pid, span, cut_sub, score_sub, erratum, prompt) in enumerate(PAIRS, 1):
        import re
        text = by_id_span[(pid, span)]
        lines = text.splitlines()
        cut_pat = re.compile("|".join(cut_sub.split("|")))
        kept = [ln for ln in lines if not cut_pat.search(ln)]
        assert len(kept) < len(lines), f"pair {i}: cut matched nothing"
        assert len(kept) > 0, f"pair {i}: cut blanked everything"
        b_text = "\n".join(kept) + "\n\n[Исправление к предыдущему ходу]: " + erratum
        pairs.append({"n": i, "kind": kind, "part": pid, "span": list(span),
                      "marker": score_sub, "erratum": erratum, "prompt": prompt,
                      "a_replay": text, "b_replay": b_text,
                      "cut_lines": len(lines) - len(kept)})
    (HERE / "AB_PAIRS.json").write_text(
        json.dumps({"model": MODEL, "pairs": pairs}, indent=1, ensure_ascii=False),
        encoding="utf-8")
    print(f"pairs={len(pairs)} model={MODEL['provider']}/{MODEL['model']}")
    for p in pairs:
        print(f"pair {p['n']} [{p['kind']}] cut={p['cut_lines']} marker={p['marker']!r}")


if __name__ == "__main__":
    sys.exit(main())
