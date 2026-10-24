#!/usr/bin/env node
// Fishbowl media harvester (D46). Rebuilds the room's photos and voice notes for the
// public replay: mines every alpha transcript's channel tags for media metadata
// (sender, exact Telegram timestamp, file id), resolves each item to a local file
// (inbox first, Bot API getFile as fallback), transcodes voice to m4a (Safari plays
// no .oga), and writes tools/alpha-dashboard/public/media/ plus manifest.json.
//
// People rule: the manifest carries FIRST NAMES ONLY (mapped through the same
// EW_FISHBOWL_NAMES map the API uses); raw usernames/ids never enter the output.
// Copyright rule: document attachments are listed as name-only markers; the files
// themselves are never mirrored (a shared PDF may be someone else's book).
//
//   node scripts/ops/fishbowl-media.mjs [--dry]
//
// Idempotent: existing output files are kept; the manifest is rebuilt every run.
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIVE_DIR = join((process.env.USERPROFILE || process.env.HOME), ".claude", "projects", join(dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/[^A-Za-z0-9]/g, "-"));
const ARCHIVE_DIR = join(repo, "state", "transcripts");
const INBOX = join(process.env.USERPROFILE || process.env.HOME, ".claude", "channels", "telegram-alpha", "inbox");
const OUT_DIR = join(repo, "tools", "alpha-dashboard", "public", "media");
const dry = process.argv.includes("--dry");

const env = {};
for (const l of readFileSync(join(repo, "avatars", "alpha", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = l.replace(/\r$/, "").match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const TOKEN = env.ALPHA_BOT_TOKEN;
const GROUP = env.ALPHA_GROUP_ID;
const NAMES = JSON.parse(env.EW_FISHBOWL_NAMES || "{}");
if (!TOKEN || !GROUP) { console.error("ALPHA_BOT_TOKEN / ALPHA_GROUP_ID missing"); process.exit(1); }

// 1. Mine channel tags with media attributes from every transcript (both dirs).
const attr = (s, k) => { const m = s.match(new RegExp(`${k}=\\"([^"]*)\\"`)); return m ? m[1] : ""; };
const items = new Map(); // message_id -> item
for (const dir of [LIVE_DIR, ARCHIVE_DIR]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    let text = "";
    try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    const tagRe = /<channel ([^>]*(?:image_path|attachment_kind)[^>]*)>/g;
    let m;
    while ((m = tagRe.exec(text)) !== null) {
      const a = m[1].replace(/\\"/g, '"');
      if (attr(a, "chat_id") !== GROUP) continue;
      const mid = attr(a, "message_id");
      if (!mid || items.has(mid)) continue;
      const imagePath = attr(a, "image_path").replace(/\\\\/g, "\\");
      items.set(mid, {
        message_id: mid,
        ts: attr(a, "ts"),
        sender: attr(a, "user") || attr(a, "user_id"),
        kind: imagePath ? "photo" : attr(a, "attachment_kind"),
        file_id: attr(a, "attachment_file_id"),
        mime: attr(a, "attachment_mime"),
        name: attr(a, "attachment_name"),
        image_path: imagePath,
      });
    }
  }
}
console.log(`tags mined: ${items.size} media messages`);

// 2. Inbox listing for timestamp matching (delivery epoch in the filename).
const inbox = existsSync(INBOX)
  ? readdirSync(INBOX).map((f) => ({ f, epoch: parseInt(f.split("-")[0], 10) })).filter((x) => Number.isFinite(x.epoch))
  : [];
const matchInbox = (tsIso, exts) => {
  const t = Date.parse(tsIso);
  if (Number.isNaN(t)) return null;
  let best = null;
  for (const x of inbox) {
    if (!exts.includes(extname(x.f).toLowerCase())) continue;
    const d = Math.abs(x.epoch - t);
    if (d < 10 * 60 * 1000 && (!best || d < best.d)) best = { ...x, d };
  }
  return best ? join(INBOX, best.f) : null;
};

async function download(file_id, dest) {
  const g = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getFile`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id }),
  })).json();
  if (!g.ok) throw new Error(`getFile: ${g.description}`);
  const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${TOKEN}/${g.result.file_path}`)).arrayBuffer());
  writeFileSync(dest, buf);
}

// 3. Resolve every item to a public file; voice transcodes to m4a.
if (!dry) mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
const claimed = new Set();
for (const it of [...items.values()].sort((a, b) => a.ts.localeCompare(b.ts))) {
  const epoch = Date.parse(it.ts);
  const from = NAMES[it.sender] || null;
  if (it.kind === "document") {
    manifest.push({ at: it.ts, kind: "document", name: it.name || "a document", from });
    continue; // marker only, never mirrored (copyright rule above)
  }
  try {
    if (it.kind === "photo") {
      const outName = `${epoch}-m${it.message_id}.jpg`;
      const dest = join(OUT_DIR, outName);
      if (!existsSync(dest)) {
        const src = existsSync(it.image_path) ? it.image_path : matchInbox(it.ts, [".jpg", ".jpeg", ".png"]);
        if (!src) throw new Error("photo file not found and no file_id to fetch");
        if (!dry) copyFileSync(src, dest);
        if (src.startsWith(INBOX)) claimed.add(basename(src));
      } else if (it.image_path) claimed.add(basename(it.image_path));
      manifest.push({ at: it.ts, kind: "photo", file: outName, from });
    } else if (it.kind === "voice" || it.kind === "audio" || it.kind === "video_note") {
      const outName = `${epoch}-m${it.message_id}.m4a`;
      const dest = join(OUT_DIR, outName);
      const src = matchInbox(it.ts, [".oga", ".ogg", ".opus", ".mp4"]);
      if (src) claimed.add(basename(src));
      if (!existsSync(dest) && !dry) {
        let oga = src;
        if (!oga) {
          if (!it.file_id) throw new Error("no local file and no file_id");
          oga = join(OUT_DIR, `${epoch}-m${it.message_id}.oga`);
          await download(it.file_id, oga);
        }
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", oga, "-c:a", "aac", "-b:a", "64k", dest]);
      }
      manifest.push({ at: it.ts, kind: "voice", file: outName, from });
    }
  } catch (e) {
    console.error(`  skip message ${it.message_id} (${it.kind}): ${e.message}`);
    manifest.push({ at: it.ts, kind: it.kind, name: it.name || undefined, from, missing: true });
  }
}

// 4. Inbox leftovers (transcript purged): include with delivery-time timestamp, no sender.
for (const x of inbox) {
  if (claimed.has(x.f)) continue;
  const ext = extname(x.f).toLowerCase();
  const at = new Date(x.epoch).toISOString();
  try {
    if ([".jpg", ".jpeg", ".png"].includes(ext)) {
      const outName = `${x.epoch}-inbox${ext}`;
      if (!dry && !existsSync(join(OUT_DIR, outName))) copyFileSync(join(INBOX, x.f), join(OUT_DIR, outName));
      manifest.push({ at, kind: "photo", file: outName, from: null });
    } else if ([".oga", ".ogg", ".opus"].includes(ext)) {
      const outName = `${x.epoch}-inbox.m4a`;
      const dest = join(OUT_DIR, outName);
      if (!dry && !existsSync(dest))
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(INBOX, x.f), "-c:a", "aac", "-b:a", "64k", dest]);
      manifest.push({ at, kind: "voice", file: outName, from: null });
    }
  } catch (e) { console.error(`  skip inbox ${x.f}: ${e.message}`); }
}

manifest.sort((a, b) => a.at.localeCompare(b.at));
if (!dry) {
  // .oga intermediates are not part of the mirror
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith(".oga")) { try { unlinkSync(join(OUT_DIR, f)); } catch {} }
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));
}
const counts = {};
for (const m of manifest) counts[m.kind + (m.missing ? " (missing)" : "")] = (counts[m.kind + (m.missing ? " (missing)" : "")] || 0) + 1;
console.log(`${dry ? "DRY " : ""}manifest: ${manifest.length} items`, counts);
