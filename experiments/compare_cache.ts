import Database from 'bun:sqlite';

const db = new Database('experiments/Test-Picke/.opencode/data/opencode.db', {readonly: true});

// Test-Picke working session
console.log('=== Test-Picke (working) ===');
const rows = db.query("SELECT time_created, data FROM message WHERE session_id = 'ses_0fab1f744ffeU3K6S0uz5jRbdz' ORDER BY time_created").all();

let n = 0;
for (const r of rows) {
  try {
    const d = JSON.parse(r.data);
    if (d.role !== 'assistant') continue;
    n++;
    const inp = d.tokens?.input || 0;
    const cacheR = d.tokens?.cache?.read || 0;
    const flag = cacheR > 0 ? 'HIT' : (inp > 5000 ? 'COLD' : '');
    const t = new Date(r.time_created).toISOString().slice(11, 19);
    console.log(n, t, 'in:', String(inp).padStart(7), 'cache_r:', String(cacheR).padStart(7), flag);
    if (n === 1) console.log('  token keys:', Object.keys(d.tokens || {}));
  } catch (e) {}
}

// Our sandbox session  
console.log('');
console.log('=== Our sandbox (failing) ===');
const sbRows = db.query("SELECT time_created, data FROM message WHERE session_id = 'ses_0fab5181effe9XQiMfl8Xn2WlO' ORDER BY time_created").all();
n = 0;
for (const r of sbRows) {
  try {
    const d = JSON.parse(r.data);
    if (d.role !== 'assistant') continue;
    n++;
    const inp = d.tokens?.input || 0;
    const cacheR = d.tokens?.cache?.read || 0;
    const flag = cacheR > 0 ? 'HIT' : (inp > 5000 ? 'COLD' : '');
    const t = new Date(r.time_created).toISOString().slice(11, 19);
    console.log(n, t, 'in:', String(inp).padStart(7), 'cache_r:', String(cacheR).padStart(7), flag);
    if (n === 1) console.log('  token keys:', Object.keys(d.tokens || {}));
  } catch (e) {}
}
