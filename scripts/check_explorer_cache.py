"""Check explorer agent cache rates in Aurora DB (read-only)."""
import sqlite3
c = sqlite3.connect(r"d:\zPython\Aurora_Python\.opencode\data\opencode.db")
c.row_factory = sqlite3.Row

rows = c.execute("""
    SELECT m.session_id, m.time_created,
           json_extract(m.data, '$.tokens.input') as inp,
           json_extract(m.data, '$.tokens.cache.read') as cr,
           json_extract(m.data, '$.agent') as agent,
           json_extract(m.data, '$.modelID') as model,
           json_extract(m.data, '$.providerID') as provider
    FROM message m
    JOIN session s ON s.id = m.session_id
    WHERE json_extract(m.data, '$.role') = 'assistant'
      AND s.parent_id IS NOT NULL
    ORDER BY m.time_created
""").fetchall()

print(f"{'SESSION':38s} {'TIME_MS':>14s} {'AGENT':>7s} {'MODEL':20s} {'PROVIDER':20s} {'INP':>8s} {'CR':>8s} {'RATIO':>7s}")
print("-" * 145)
for r in rows:
    it = int(r["inp"] or 0); cr = int(r["cr"] or 0)
    ratio = cr / max(1, it + cr)
    print(f"{r['session_id'][:38]:38s} {r['time_created']:>14} {r['agent'] or '?':>7} {(r['model'] or '?')[:20]:20} {(r['provider'] or '?')[:20]:20} {it:>8,d} {cr:>8,d} {ratio:>7.4f}")

hits = sum(1 for r in rows if (r["cr"] or 0) > 0)
print(f"\nTotal: {len(rows)} msgs | Cache hits: {hits} | Cold: {len(rows)-hits}")
c.close()
