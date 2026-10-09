#!/usr/bin/env node
// Send a Telegram message to Alan via the Genesis bot (ops notifications only;
// Genesis's own replies go through the channel plugin, never this script).
// Usage:
//   node scripts/ops/send-telegram.mjs "message text"
//   node scripts/ops/send-telegram.mjs --diary   (sends latest diary + night-loop status)
// Reads TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID, SUPABASE_URL,
// SUPABASE_SERVICE_KEY from .env.local next to the repo root. Never prints secrets.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = {};
for (const line of readFileSync(join(repo, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\r$/, '');
}
const need = k => { if (!env[k]) { console.error(`missing ${k} in .env.local`); process.exit(1); } return env[k]; };
const token = need('TELEGRAM_BOT_TOKEN');
const chatId = need('TELEGRAM_ALLOWED_USER_ID');

async function send(text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
  const j = await r.json();
  if (!j.ok) { console.error(`sendMessage failed: ${j.error_code} ${j.description}`); process.exit(1); }
  console.log(`sent message_id=${j.result.message_id}`);
}

const args = process.argv.slice(2);
if (args[0] === '--diary') {
  const url = need('SUPABASE_URL'); const svc = need('SUPABASE_SERVICE_KEY');
  const r = await fetch(`${url}/rest/v1/thoughts?source_type=eq.diary&select=created_at,metadata,content&order=created_at.desc&limit=1`,
    { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    await send('Night loop notice: no diary found in OB1. Check logs/genesis-night.log.');
  } else {
    const d = rows[0];
    const runId = d.metadata?.night_loop_run_id ?? 'unknown-run';
    const ageH = (Date.now() - new Date(d.created_at).getTime()) / 36e5;
    const stale = ageH > 24 ? ` WARNING: this diary is ${Math.round(ageH)}h old - tonight's loop may have failed; check logs/genesis-night.log.` : '';
    await send(`Genesis night loop (${runId}) - diary:${stale}\n\n${d.content}`);
  }
} else if (args.length > 0) {
  await send(args.join(' '));
} else {
  console.error('usage: send-telegram.mjs "text" | --diary');
  process.exit(1);
}
