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
const by = {};
for (const r of rows) { const k = r.model; (by[k] ||= []).push(r); }
for (const [k, v] of Object.entries(by)) {
  const s = v.map(r => r.secs).filter(x => x >= 0 && x < 7200).sort((a, b) => a - b);
  const w = v.map(r => r.words).sort((a, b) => a - b);
  console.log(k, 'replies', v.length, 'days', v[0].day, '..', v.at(-1).day, 'median secs', s[s.length >> 1], 'median words', w[w.length >> 1]);
}
