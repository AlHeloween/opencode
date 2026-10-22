"""make_receipts.py — the receipts of the t141 replay, written to files (UTF-8, LF).

Everything here is regenerable: run this script again and the receipts come back. The only thing it
does NOT regenerate is the finding itself (REPORT.md).

Usage: python make_receipts.py
"""
import datetime
import difflib
import hashlib
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
WAVE = pathlib.Path("D:/zPython/opencode/experiments/2026-10-08_robot-wave")
REC = HERE / "receipts"
REC.mkdir(exist_ok=True)


def write(path, text):
    path.write_text(text, encoding="utf-8", newline="\n")
    print("wrote " + str(path) + " (" + str(path.stat().st_size) + " bytes)")


def run(cmd, cwd, out):
    p = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    write(REC / out, "command: " + " ".join(str(c) for c in cmd) + "\nexit: " + str(p.returncode)
          + "\n\n" + p.stdout + ("\nSTDERR:\n" + p.stderr if p.stderr else ""))
    return p.returncode, p.stdout


rc1, _ = run([sys.executable, "replay_t141.py"], HERE, "replay-t141.txt")
# The t118 oracle's CURRENT run. The 15/17 finding's receipt (replay-t118-after.txt) is history and
# is NOT regenerated: it is the evidence of the defect this task fixed.
rc2, _ = run([sys.executable, "replay_watch3.py"],
             pathlib.Path("D:/zPython/opencode/experiments/2026-10-21_robot-pending-stop"),
             "replay-t118-now.txt")

# The patch of the live watcher (the wave is gitignored: the patch is the versioned record).
a = (WAVE / "watch3_before_t141.py").read_text(encoding="utf-8").splitlines(keepends=True)
b = (WAVE / "watch3.py").read_text(encoding="utf-8").splitlines(keepends=True)
patch = "".join(difflib.unified_diff(a, b, fromfile="a/watch3_before_t141.py",
                                     tofile="b/watch3.py", n=3))
write(HERE / "watch3-t141.patch", patch)

# The proof that the t118 BASELINE behaviour did not change: the baseline posts exactly dispatch.MODEL.
probe = (
    "import json, os, subprocess, sys, tempfile, pathlib\n"
    "WAVE = pathlib.Path('D:/zPython/opencode/experiments/2026-10-08_robot-wave')\n"
    "SID = 'ses_t118_fixture'\n"
    "OWNER = {'providerID':'opencode-go','modelID':'minimax-m3.1-flash-free','variant':'xhigh'}\n"
    "rows = [{'info':{'role':'user','id':'msg_u1','model':OWNER},'parts':[{'type':'text','text':'do the work'}]},\n"
    "        {'info':{'role':'assistant','id':'msg_a1','modelID':'muse','providerID':'opencode-go'},\n"
    "         'parts':[{'type':'text','text':'still working, no SV yet'}]}]\n"
    "fx = {'questions':[],'permissions':[],'status':{SID:{'type':'idle'}},"
    "'messages':{SID:rows},'watchers':[]}\n"
    "with tempfile.TemporaryDirectory() as tmp:\n"
    "    p = pathlib.Path(tmp)/'fx.json'; p.write_text(json.dumps(fx), encoding='utf-8')\n"
    "    env = dict(os.environ, ROBOT_WATCH3_FIXTURE=str(p))\n"
    "    r = subprocess.run([sys.executable, str(WAVE/'watch3_before_addendum2.py'), 'name='+SID],\n"
    "                       capture_output=True, text=True, timeout=60, env=env)\n"
    "    posted = None\n"
    "    for line in r.stdout.splitlines():\n"
    "        if line.startswith('post: '):\n"
    "            posted = (json.loads(line[6:]).get('body') or {}).get('model')\n"
    "sys.path.insert(0, str(WAVE))\n"
    "import dispatch\n"
    "print('baseline posted model :', json.dumps(posted, ensure_ascii=False))\n"
    "print('dispatch.MODEL        :', json.dumps(dispatch.MODEL, ensure_ascii=False))\n"
    "print('equal                 :', posted == dispatch.MODEL)\n"
)
rc3, out3 = run([sys.executable, "-c", probe], HERE, "t118-baseline-model-probe.txt")

# Which model the t118 oracle compares against, and what that costs the cases: the FIXTURE's rows
# must stay distinct, and the pair (new posts the session model, old posts the fleet model) only
# discriminates while the two differ.
scope = (
    "import importlib.util, sys\n"
    "sys.path.insert(0, 'D:/zPython/opencode/experiments/2026-10-08_robot-wave')\n"
    "spec = importlib.util.spec_from_file_location('replay_watch3',\n"
    "    'D:/zPython/opencode/experiments/2026-10-21_robot-pending-stop/replay_watch3.py')\n"
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
    "print('FLEET  (dispatch.MODEL, live)  :', m.FLEET)\n"
    "print('MUSE   (a fixture row model)   :', m.MUSE)\n"
    "print('OWNER  (the fixture session)  :', m.OWNER_MODEL['modelID'])\n"
    "print('W8 rows distinct (applied)    :', m.MUSE != m.OWNER_MODEL['modelID'])\n"
    "print('W8 rows (one-constant variant):', m.FLEET != m.OWNER_MODEL['modelID'],\n"
    "      '  False => the case cannot tell WHICH row decided')\n"
    "print('W3/W8 pair discriminates      :', m.OWNER_MODEL['modelID'] != m.FLEET,\n"
    "      '  needs the fixture session model != the fleet model')\n"
)
rc5, _ = run([sys.executable, "-c", scope], HERE, "t118-oracle-model-scope.txt")

# The live state at the time of the fix: who watches what, and whether t135 is still watched.
live = (
    "import sys, json\n"
    "sys.path.insert(0,'D:/zPython/opencode/tools')\n"
    "sys.path.insert(0,'D:/zPython/opencode/experiments/2026-10-08_robot-wave')\n"
    "import watch3_procs\n"
    "from opencode_host import connect\n"
    "h = connect('D:/zPython/opencode')\n"
    "st = h.get('/session/status') or {}\n"
    "print('watchers:', json.dumps(watch3_procs.watch3_processes(), ensure_ascii=False, indent=1))\n"
    "print('busy sessions:', json.dumps({k: v.get('type') for k, v in st.items()}, ensure_ascii=False))\n"
    "print('t135 (ses_e9ffe1e38ffeom6UvwKP1ZNMgo) in status:', st.get('ses_e9ffe1e38ffeom6UvwKP1ZNMgo'))\n"
)
rc4, _ = run([sys.executable, "-c", live], HERE, "live-state.txt")

# The hashes of every file the change touches.
lines = []
for p in [WAVE / "watch3.py", WAVE / "watch3_before_t141.py", WAVE / "dispatch.py",
          HERE / "replay_t141.py", HERE / "make_receipts.py"]:
    lines.append(p.name + "  sha256 " + hashlib.sha256(p.read_bytes()).hexdigest()
                 + "  bytes " + str(p.stat().st_size)
                 + "  mtime " + datetime.datetime.fromtimestamp(p.stat().st_mtime).isoformat())
write(REC / "hashes.txt", "\n".join(lines) + "\n")

print("exits: replay_t141=" + str(rc1) + " replay_t118=" + str(rc2) + " probe=" + str(rc3)
      + " live=" + str(rc4) + " scope=" + str(rc5))
