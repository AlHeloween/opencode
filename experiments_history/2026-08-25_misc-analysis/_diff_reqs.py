import json, hashlib, sys

files = [
    (r'D:\zPython\opencode\.opencode\data\gateway\per-request\1786455480651_req_4dfdb0be-3b88-4acc-bc91-c699024de3b8.json', 'A'),
    (r'D:\zPython\opencode\.opencode\data\gateway\per-request\1786455493356_req_e8b0a8f0-fd3b-468e-b3d6-8d3e233728d2.json', 'B'),
    (r'D:\zPython\opencode\.opencode\data\gateway\per-request\1786455502956_req_16bb3a99-96b1-44f2-b454-66812bb079f0.json', 'C'),
    (r'D:\zPython\opencode\.opencode\data\gateway\per-request\1786455517946_req_98cb6295-c31f-4082-959f-86cd83b6c228.json', 'D'),
    (r'D:\zPython\opencode\.opencode\data\gateway\per-request\1786455528823_req_ec1d34b0-3973-42d9-be29-4e8c5e949503.json', 'E'),
]

ref_hashes = None
ref_len = None

for fpath, label in files:
    d = json.load(open(fpath, 'r', encoding='utf-8'))
    sys_msgs = [m for m in d['body']['messages'] if m['role'] == 'system']
    hashes = [hashlib.md5(m['content'].encode()).hexdigest()[:10] for m in sys_msgs]
    total = sum(len(m['content']) for m in sys_msgs)
    
    # tools
    task_desc = ''
    skill_desc = ''
    for t in d['body'].get('tools', []):
        if t['function']['name'] == 'task':
            task_desc = t['function']['description']
        if t['function']['name'] == 'skill':
            skill_desc = t['function']['description']
    task_ok = 'coder_agent' in task_desc
    skill_ok = 'compaction' in skill_desc
    
    if ref_hashes is None:
        ref_hashes = hashes
        ref_len = total
        print(f'{label}: {len(sys_msgs)}msgs {total}B task_ok={task_ok} skill_ok={skill_ok}  REFERENCE')
    else:
        match = sum(1 for i in range(min(len(ref_hashes), len(hashes))) if ref_hashes[i] == hashes[i])
        diff_i = next((i for i in range(min(len(ref_hashes), len(hashes))) if ref_hashes[i] != hashes[i]), -1)
        print(f'{label}: {len(sys_msgs)}msgs {total}B task_ok={task_ok} skill_ok={skill_ok}  match={match}/{len(hashes)} diff_at=sys[{diff_i}] bytes_delta={total-ref_len:+d}')

# Tools byte-level comparison for all pairs vs reference
def tools_sorted(d):
    return sorted(d['body'].get('tools', []), key=lambda t: t['function']['name'])

print()
for fpath, label in files:
    d = json.load(open(fpath, 'r', encoding='utf-8'))
    tools = tools_sorted(d)
    tjson = json.dumps(tools, sort_keys=True, ensure_ascii=True)
    thash = hashlib.sha256(tjson.encode()).hexdigest()[:16]
    names = [t['function']['name'] for t in tools]
    print(f'{label} tools: {len(tools)} items, {len(tjson)}B JSON, sha256={thash}')

# Compare A vs B tools byte-level
dA = json.load(open(files[0][0], 'r', encoding='utf-8'))
dB = json.load(open(files[1][0], 'r', encoding='utf-8'))
tA = {t['function']['name']: t['function'] for t in dA['body']['tools']}
tB = {t['function']['name']: t['function'] for t in dB['body']['tools']}

print('\n--- TOOLS A vs B ---')
for name in sorted(set(tA) | set(tB)):
    inA = name in tA
    inB = name in tB
    status = 'IDENTICAL' if inA and inB and json.dumps(tA[name],sort_keys=True)==json.dumps(tB[name],sort_keys=True) else ''
    if not status:
        status = 'A_ONLY' if inA else 'B_ONLY'
    if not inA and not inB: continue
    a_len = len(json.dumps(tA[name],sort_keys=True)) if inA else 0
    b_len = len(json.dumps(tB[name],sort_keys=True)) if inB else 0
    if status != 'IDENTICAL':
        print(f'  {name}: {status} (A={a_len}B B={b_len}B)')
