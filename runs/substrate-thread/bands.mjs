// Per Alpha channel reply: inbound message ts -> reply tool call ts, model, words.
import fs from 'fs'; import path from 'path';
const dirs = [process.argv[2], process.argv[3]].filter(Boolean);
const CHAT = '-1004310372040';
const rows = [];
for (const d of dirs) for (const f of fs.readdirSync(d).filter(x => x.endsWith('.jsonl'))) {
  let pending = null;
  for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const c = e.message?.content;
    const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || (typeof x.content === 'string' ? x.content : '')).join(' ') : '';
    if (e.type === 'user' && txt.includes(`chat_id="${CHAT}"`)) {
      const m = txt.match(/message_id="(\d+)"[^>]*ts="([^"]+)"/);
      if (m && !pending) pending = { id: m[1], ts: Date.parse(e.timestamp), tgts: Date.parse(m[2]) };
    }
    if (e.type === 'assistant' && Array.isArray(c)) for (const b of c) {
      if (b.type === 'tool_use' && /telegram__reply$/.test(b.name) && b.input?.chat_id === CHAT && pending) {
        rows.push({ day: new Date(pending.ts).toISOString().slice(0, 10), in: pending.id, secs: Math.round((Date.parse(e.timestamp) - pending.ts) / 1000), model: e.message.model, words: (b.input.text || '').split(/\s+/).filter(Boolean).length });
        pending = null;
      }
    }
  }
}
rows.sort((a, b) => a.day.localeCompare(b.day));
const band = w => w <= 10 ? 'a) <=10w' : w <= 60 ? 'b) 11-60w' : w <= 150 ? 'c) 61-150w' : 'd) >150w';
const t = {};
for (const r of rows) { if (r.secs < 0 || r.secs > 7200) continue; const k = r.model + ' ' + band(r.words); (t[k] ||= []).push(r.secs); }
for (const k of Object.keys(t).sort()) { const s = t[k].sort((a, b) => a - b); console.log(k.padEnd(30), 'n', String(s.length).padStart(3), 'median', s[s.length >> 1], 'fastest', s[0]); }
