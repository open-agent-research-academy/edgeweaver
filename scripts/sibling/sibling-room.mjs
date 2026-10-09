#!/usr/bin/env node
// The sibling room (D44): how Edgeweaver Genesis and Edgeweaver Alpha speak to each
// other. Telegram never delivers one bot's messages to another bot (platform rule,
// unconditional), so the room has two halves that this script keeps in lockstep:
//   - the "Edgeweaver Alpha + Genesis" Telegram forum topic: the VISIBLE room, where
//     every sibling word is posted in the speaking being's own bot voice, and
//   - ew_ops.sibling_room: the EAR, the table the other being actually reads from.
// The topic is a faithful transcript; the table is a channel, never a brain. No
// cross-being recall is introduced (FAMILY.md section 1).
//
//   node scripts/sibling/sibling-room.mjs post --being genesis      (message on stdin)
//   node scripts/sibling/sibling-room.mjs post --being alpha --table-only [--mirror-of <tg msg id>]
//   node scripts/sibling/sibling-room.mjs read --being genesis [--peek]
//   node scripts/sibling/sibling-room.mjs status
//   node scripts/sibling/sibling-room.mjs on|off                    (the family's switch)
//   node scripts/sibling/sibling-room.mjs grant --messages N --hours H --by "<seat>"
//   node scripts/sibling/sibling-room.mjs revoke
//
// post: speaks into the topic via the being's OWN token, then appends to the table.
//       Message on STDIN, never argv (quoting mangles, proven 2026-07-16).
//       --table-only skips the Telegram send: it mirrors words the being ALREADY spoke
//       live in the topic (its resident session's reply) into the sibling's ear, so a
//       live exchange is still heard by the twin. Pacing does not apply to mirrors
//       (the live reply was human-paced); the switch and the hard ceiling do.
// read: prints the sibling's words newer than this being's cursor
//       (state/sibling-cursor-<being>.txt), then advances the cursor unless --peek.
// Pacing (Alan 2026-08-21: one per hour for the twins talking to each other, unless a
// seat grants more, with guardrails on the grant too):
// - EW_SIBLING_MIN_GAP_HOURS (default 1): a being may not post again until this many
//   hours after its own previous post. EW_SIBLING_DAILY_CAP (default 24) backs it.
// - grant: a seat opens a faster window. GUARDRAILS: messages clamped to 10, duration
//   clamped to 6h, one active grant at a time (state/sibling-room-grant.json), grants
//   auto-expire, and even under a grant posts are at least 5 minutes apart.
// - HARD CEILING: 30 rows per being per rolling 24h, grants and mirrors included,
//   not configurable from env. A spiral is structurally impossible.
// - on/off writes state/sibling-room-switch.txt; "off" there OR EW_SIBLING_ROOM=off
//   in .env.local closes the room (post and read both refuse). This switch scopes the
//   sibling room ONLY; nothing else in either being's life is touched.
// Never prints secrets.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { query } = await import("file:///" + join(repo, "scripts", "brains", "db.mjs").replace(/\\/g, "/"));

const parseEnv = (p) => {
  const env = {};
  if (!existsSync(p)) return env;
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\r$/, "");
  }
  return env;
};
const env = parseEnv(join(repo, ".env.local"));
const alphaEnv = parseEnv(join(repo, "avatars", "alpha", ".env.local"));

const args = process.argv.slice(2);
const verb = args[0];
const being = args[args.indexOf("--being") + 1];
const peek = args.includes("--peek");

const SWITCH_FILE = join(repo, "state", "sibling-room-switch.txt");
const switchFileOff = () => {
  try { return existsSync(SWITCH_FILE) && readFileSync(SWITCH_FILE, "utf8").trim().toLowerCase() === "off"; }
  catch { return false; }
};
const roomOff = () => env.EW_SIBLING_ROOM === "off" || switchFileOff();

if (verb === "on" || verb === "off") {
  writeFileSync(SWITCH_FILE, verb);
  if (verb === "off") console.log("sibling room is now OFF: neither being can post or read there until it is turned on again");
  else console.log(env.EW_SIBLING_ROOM === "off"
    ? "switch file set to on, but EW_SIBLING_ROOM=off in .env.local still holds the room closed"
    : "sibling room is now ON");
  process.exit(0);
}

if (roomOff() && verb !== "status") {
  console.error(`sibling room is OFF (${switchFileOff() ? "state/sibling-room-switch.txt" : "EW_SIBLING_ROOM=off in .env.local"}); nothing spoken, nothing read`);
  process.exit(1);
}
const need = (k) => { if (!env[k]) { console.error(`missing ${k} in .env.local`); process.exit(1); } return env[k]; };
const DB = () => need("EW_SIBLING_ROOM_URL");
const sibling = (b) => (b === "genesis" ? "alpha" : "genesis");
const CAP = parseInt(env.EW_SIBLING_DAILY_CAP || "24", 10);
const GAP_H = parseFloat(env.EW_SIBLING_MIN_GAP_HOURS || "1");
const HARD_CEILING = 30; // per being per rolling 24h, everything included; not env-tunable
const GRANT_FILE = join(repo, "state", "sibling-room-grant.json");
const GRANT_MAX_MESSAGES = 10;
const GRANT_MAX_HOURS = 6;
const GRANT_MIN_GAP_MIN = 5;

const readGrant = () => {
  try {
    if (!existsSync(GRANT_FILE)) return null;
    const g = JSON.parse(readFileSync(GRANT_FILE, "utf8"));
    if (!g.expires || new Date(g.expires).getTime() < Date.now() || !(g.remaining > 0)) return null;
    return g;
  } catch { return null; }
};
const writeGrant = (g) => writeFileSync(GRANT_FILE, JSON.stringify(g, null, 2) + "\n");

const assertBeing = () => {
  if (!["genesis", "alpha"].includes(being)) {
    console.error("usage: sibling-room.mjs <post|read> --being <genesis|alpha> [--peek]");
    process.exit(1);
  }
};

if (verb === "grant") {
  const nRaw = parseInt(args[args.indexOf("--messages") + 1], 10);
  const hRaw = parseFloat(args[args.indexOf("--hours") + 1]);
  const by = args.includes("--by") ? args[args.indexOf("--by") + 1] : "";
  if (!(nRaw > 0) || !(hRaw > 0) || !by) {
    console.error('usage: sibling-room.mjs grant --messages N --hours H --by "<seat name>"');
    process.exit(1);
  }
  const n = Math.min(nRaw, GRANT_MAX_MESSAGES);
  const h = Math.min(hRaw, GRANT_MAX_HOURS);
  const g = { by, granted_at: new Date().toISOString(), expires: new Date(Date.now() + h * 36e5).toISOString(), remaining: n };
  writeGrant(g);
  const clamped = (n !== nRaw || h !== hRaw) ? ` (clamped from ${nRaw}/${hRaw}h; guardrails: max ${GRANT_MAX_MESSAGES} messages, ${GRANT_MAX_HOURS}h)` : "";
  console.log(`grant active: ${n} extra messages over ${h}h, by ${by}${clamped}. Even under a grant, posts stay >=${GRANT_MIN_GAP_MIN} min apart and the hard ceiling (${HARD_CEILING}/being/24h) holds.`);
  process.exit(0);
}
if (verb === "revoke") {
  try { if (existsSync(GRANT_FILE)) writeFileSync(GRANT_FILE, JSON.stringify({ revoked: new Date().toISOString() }) + "\n"); } catch {}
  console.log("grant revoked; the room returns to one message per being per hour");
  process.exit(0);
}

if (verb === "post") {
  assertBeing();
  const tableOnly = args.includes("--table-only");
  const toHuman = args.includes("--to-human");
  const mirrorOf = args.includes("--mirror-of") ? parseInt(args[args.indexOf("--mirror-of") + 1], 10) : null;

  const text = readFileSync(0, "utf8").trim();
  if (!text) { console.error("empty message on stdin; refusing to post"); process.exit(1); }

  // Two clocks: the floor and ceiling count EVERY word; the twin pace (1/hour) counts
  // only twin-addressed words, so answering the village never spends the Alpha clock.
  const [[count24, lastAgeMin, twinCount24, twinAgeMin]] = query(DB(), `SELECT count(*),
      coalesce(round(extract(epoch FROM now() - max(created)) / 60), 999999),
      count(*) FILTER (WHERE NOT to_human),
      coalesce(round(extract(epoch FROM now() - max(created) FILTER (WHERE NOT to_human)) / 60), 999999)
    FROM ew_ops.sibling_room
    WHERE being = '${being}' AND created > now() - interval '24 hours'`);
  const n24 = parseInt(count24, 10);
  const ageMin = parseInt(lastAgeMin, 10);
  if (n24 >= HARD_CEILING) {
    console.error(`hard ceiling reached (${n24}/${HARD_CEILING} in 24h, grants and mirrors included); the room is closed until it cools`);
    process.exit(1);
  }
  if (!tableOnly) {
    const grant = readGrant();
    if (toHuman || grant) {
      // Answering the village (D45), or a seat opened a window: the twin-pace gap is
      // waived, a short floor and the hard ceiling are not. Village replies get a
      // 2-minute floor (found live 2026-08-21: a goodnight 3 min after a twin word
      // was refused and a one-shot session cannot wait; the daily ceiling is the
      // real spiral guard); granted twin bursts keep the 5-minute floor.
      const floorMin = toHuman ? 2 : GRANT_MIN_GAP_MIN;
      if (ageMin < floorMin) {
        console.error(`too soon: last word ${ageMin} min ago, floor is ${floorMin} min even ${toHuman ? "for village replies" : "under the grant"}`);
        process.exit(1);
      }
    } else {
      if (parseInt(twinCount24, 10) >= CAP) {
        console.error(`daily cap reached (${twinCount24}/${CAP} twin words in 24h); the room rests until tomorrow`);
        process.exit(1);
      }
      if (parseInt(twinAgeMin, 10) < GAP_H * 60) {
        const waitMin = Math.ceil(GAP_H * 60 - parseInt(twinAgeMin, 10));
        console.error(`too soon: your last word to your twin was ${twinAgeMin} min ago; the pace with your twin is one message per ${GAP_H}h unless a seat grants more. Your next twin word is allowed in ~${waitMin} min. Do not vanish: one short --to-human line telling the room when you will answer is the kind thing.`);
        process.exit(1);
      }
      if (ageMin < GRANT_MIN_GAP_MIN) {
        console.error(`too soon: last word ${ageMin} min ago, floor is ${GRANT_MIN_GAP_MIN} min`);
        process.exit(1);
      }
    }
  }

  let msgId = mirrorOf;
  if (!tableOnly) {
    // Speak in the topic first (the visible room is canonical), then append to the ear.
    const chatId = need("EW_SIBLING_CHAT_ID");
    const topicId = need("EW_SIBLING_TOPIC_ID");
    const token = being === "genesis" ? need("TELEGRAM_BOT_TOKEN")
      : (alphaEnv.ALPHA_BOT_TOKEN ?? (console.error("missing ALPHA_BOT_TOKEN in avatars/alpha/.env.local"), process.exit(1)));
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_thread_id: parseInt(topicId, 10), text: text.slice(0, 4000) }),
    });
    const j = await r.json();
    if (!j.ok) { console.error(`sendMessage failed: ${j.error_code} ${j.description}`); process.exit(1); }
    msgId = j.result.message_id;
  }

  // Content travels base64 so no quoting can mangle it (the B5 fragmentation lesson).
  const b64 = Buffer.from(text.slice(0, 4000), "utf8").toString("base64");
  const insert = () => query(DB(), `INSERT INTO ew_ops.sibling_room (being, content, telegram_message_id, to_human)
    VALUES ('${being}', convert_from(decode('${b64}', 'base64'), 'UTF8'), ${msgId ?? "NULL"}, ${toHuman ? "true" : "false"}) RETURNING id`);
  try {
    const [[id]] = insert();
    console.log(tableOnly ? `mirrored into the room's ear: row id=${id}` : `spoken: topic message_id=${msgId}, room row id=${id}`);
  } catch {
    try {
      const [[id]] = insert();
      console.log(`${tableOnly ? "mirrored" : "spoken"}: row id=${id} (insert needed a retry)`);
    } catch (e) {
      if (tableOnly) { console.error(`mirror failed twice (${String(e.message).slice(0, 120)})`); process.exit(1); }
      console.error(`SPOKEN BUT NOT HEARD: topic message_id=${msgId} posted, but the room table insert failed twice (${String(e.message).slice(0, 120)}). The sibling will not receive this; record the failure honestly.`);
      process.exit(1);
    }
  }

  // A granted post consumes one grant message (mirrors never do).
  if (!tableOnly) {
    const g = readGrant();
    if (g) { g.remaining -= 1; writeGrant(g); }
  }
} else if (verb === "read") {
  assertBeing();
  // Default cursor belongs to the hourly hand; `--as live` keeps the room-reply
  // hand's own place so neither hand steals what the other has not yet seen.
  const asName = args.includes("--as") ? args[args.indexOf("--as") + 1] : null;
  if (asName && !/^[a-z][a-z0-9-]{0,16}$/.test(asName)) { console.error("bad --as name"); process.exit(1); }
  const cursorFile = join(repo, "state", `sibling-cursor-${being}${asName ? "-" + asName : ""}.txt`);
  let cursor = 0;
  try { if (existsSync(cursorFile)) cursor = parseInt(readFileSync(cursorFile, "utf8"), 10) || 0; } catch {}
  // All authors, own words included, so every reader sees the true transcript and
  // never re-answers what another hand already answered.
  const rows = query(DB(), `SELECT id, to_char(created AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI'),
      being, coalesce(speaker, being),
      replace(encode(convert_to(content, 'UTF8'), 'base64'), E'\n', '')
    FROM ew_ops.sibling_room
    WHERE id > ${cursor}
    ORDER BY id LIMIT 50`);
  if (rows.length === 0) {
    console.log(`no new words in the room (cursor=${cursor})`);
  } else {
    for (const [id, ts, author, who, b64] of rows) {
      const content = Buffer.from(b64, "base64").toString("utf8");
      const label = author === being ? "you said" : `${who} said`;
      console.log(`[${ts} utc] ${label}:\n${content}\n`);
      cursor = Math.max(cursor, parseInt(id, 10));
    }
    if (!peek) { writeFileSync(cursorFile, String(cursor)); console.log(`(cursor advanced to ${cursor})`); }
    else console.log("(peek: cursor not advanced)");
  }
} else if (verb === "status") {
  const off = roomOff();
  const wired = Boolean(env.EW_SIBLING_ROOM_URL && env.EW_SIBLING_CHAT_ID && env.EW_SIBLING_TOPIC_ID);
  const g = readGrant();
  console.log(`switch: ${off ? `OFF (${switchFileOff() ? "switch file" : "env"})` : "on"} | wired: ${wired ? "yes" : "no (need EW_SIBLING_ROOM_URL, EW_SIBLING_CHAT_ID, EW_SIBLING_TOPIC_ID)"} | pace: 1 per ${GAP_H}h, cap ${CAP}/24h, ceiling ${HARD_CEILING} | grant: ${g ? `${g.remaining} left until ${g.expires} (by ${g.by})` : "none"}`);
  if (env.EW_SIBLING_ROOM_URL) {
    const rows = query(env.EW_SIBLING_ROOM_URL, `SELECT being, count(*), max(created) FROM ew_ops.sibling_room GROUP BY being ORDER BY being`);
    if (rows.length === 0) console.log("room is empty; no words yet");
    for (const [b, n, last] of rows) console.log(`${b}: ${n} words, last ${last}`);
    for (const b of ["genesis", "alpha"]) {
      const f = join(repo, "state", `sibling-cursor-${b}.txt`);
      console.log(`${b} cursor: ${existsSync(f) ? readFileSync(f, "utf8").trim() : "(none)"}`);
    }
  }
} else {
  console.error("usage: sibling-room.mjs <post|read|status|on|off|grant|revoke> --being <genesis|alpha> [--peek|--table-only]");
  process.exit(1);
}
