#!/usr/bin/env node
// Send a Telegram message into the "Edgeweaver Alpha" group via Alpha's bot (ops
// notifications and night delivery only; Alpha's own replies go through the channel
// plugin, never this script). Written at birth run B6, DARK: nothing calls it until B8
// arming, and it refuses to run before the channel is live unless --force is passed.
// Usage:
//   node scripts/ops/send-telegram-alpha.mjs "message text"   (ops notice, General topic)
//   node scripts/ops/send-telegram-alpha.mjs --dream   (latest ew_alpha dream to the night topic)
//   node scripts/ops/send-telegram-alpha.mjs --diary   (latest ew_alpha diary to the night topic)
// Reads ALPHA_BOT_TOKEN, ALPHA_GROUP_ID, EW_ALPHA_DB_URL from avatars/alpha/.env.local.
// Night delivery (dream, diary) lands in the forum topic named by EW_NIGHT_TOPIC_ALPHA
// (D49, 2026-09-11: the "Edgeweaver Alpha dreams and daydreams" topic; unset means the
// General topic, the pre-D49 room). Ops notices always go to General so people see them
// where they talk. The topic id is a coordinate: env file only, never git.
// Diary and dream are read through Alpha's own room role (the walls are the enforcement),
// never a service key. Never prints secrets.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../brains/db.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const line of readFileSync(join(repo, "avatars", "alpha", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\r$/, "");
}
const need = (k) => { if (!env[k]) { console.error(`missing ${k} in avatars/alpha/.env.local`); process.exit(1); } return env[k]; };
const token = need("ALPHA_BOT_TOKEN");
const chatId = need("ALPHA_GROUP_ID");
const nightTopicId = env.EW_NIGHT_TOPIC_ALPHA;

// Pre-birth guard: the bot stays silent until B8 arming drops the armed marker.
const armedMarker = join(repo, "state", "alpha-channel-armed");
const args = process.argv.slice(2);
const force = args.includes("--force");
if (!existsSync(armedMarker) && !force) {
  console.error("refusing: state/alpha-channel-armed absent (pre-birth rule; B8 arming creates it). Use --force only for a sanctioned ops-labeled test.");
  process.exit(1);
}

// topic: true routes into the night topic when EW_NIGHT_TOPIC_ALPHA is set; false is General.
async function send(text, { topic = false } = {}) {
  const body = { chat_id: chatId, text: text.slice(0, 4000) };
  if (topic && nightTopicId) body.message_thread_id = parseInt(nightTopicId, 10);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) { console.error(`sendMessage failed: ${j.error_code} ${j.description}`); process.exit(1); }
  const where = j.result.message_thread_id ? `topic=${j.result.message_thread_id}` : "topic=general";
  console.log(`sent message_id=${j.result.message_id} ${where}`);
}

// Latest night-loop output of one class. Content is multi-line and query() parses psql
// output by lines and pipes (the B5 fragmentation lesson), so it travels base64-encoded.
function latestNight(sourceType) {
  const db = need("EW_ALPHA_DB_URL");
  const rows = query(db, `SELECT created_at, metadata->>'night_loop_run_id',
  replace(encode(convert_to(content, 'UTF8'), 'base64'), E'\n', '')
FROM ew_alpha.thoughts WHERE source_type = '${sourceType}' ORDER BY created_at DESC LIMIT 1`);
  if (!rows.length) return null;
  const [created, runId, b64] = rows[0];
  const content = Buffer.from(b64, "base64").toString("utf8");
  const ageH = (Date.now() - new Date(created).getTime()) / 36e5;
  return { runId, content, ageH };
}

const rest = args.filter((a) => a !== "--force");
if (rest[0] === "--diary") {
  const d = latestNight("diary");
  if (!d) {
    await send("Night loop notice: no diary found in Alpha's room. Check logs/alpha-night.log. (Automated ops notice, not Alpha.)");
  } else {
    const stale = d.ageH > 24 ? ` WARNING: this diary is ${Math.round(d.ageH)}h old - tonight's loop may have failed; check logs/alpha-night.log.` : "";
    await send(`Alpha night loop (${d.runId ?? "unknown-run"}) - diary:${stale}\n\n${d.content}`, { topic: true });
  }
} else if (rest[0] === "--dream") {
  // A dream is fiction class (one per night); a stale one is never re-told as tonight's.
  const d = latestNight("dream");
  if (!d) {
    await send("Night loop notice: no dream found in Alpha's room. Check logs/alpha-night.log. (Automated ops notice, not Alpha.)");
  } else if (d.ageH > 24) {
    await send(`Night loop notice: no dream tonight; the latest is ${Math.round(d.ageH)}h old. Check logs/alpha-night.log. (Automated ops notice, not Alpha.)`);
  } else {
    await send(`Alpha dreamed (${d.runId ?? "unknown-run"}):\n\n${d.content}`, { topic: true });
  }
} else if (rest.length > 0) {
  await send(rest.join(" "));
} else {
  console.error('usage: send-telegram-alpha.mjs [--force] "text" | --dream | --diary');
  process.exit(1);
}
