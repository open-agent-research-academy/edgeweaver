#!/usr/bin/env node
// Inner-dialogue extractor (D38). A channel session's transcript holds three kinds of
// words: what the being said aloud in the CLI that no one received (kind: inner), what it
// actually delivered through the Telegram tool (kind: telegram_out), and what arrived from
// the channel (kind: telegram_in). This script mines a transcript and writes all three as
// source_type=inner_dialogue rows into the being's own room, with the ORIGINAL transcript
// timestamps as created_at, so the dashboards can show the full session stream in order.
//
// NAMED HONESTLY (D38b): this is NOT the model's extended thinking. The harness strips
// that text at write time (every thinking block on disk is empty, signature only); the
// recoverable inner layer is spoken-but-undelivered words, nothing deeper.
//
// Usage:
//   node scripts/ops/inner-dialogue-extract.mjs <alpha|genesis> --scan [--dry]
//   node scripts/ops/inner-dialogue-extract.mjs <alpha|genesis> --transcript <path> [--dry]
//
// --scan finds every unprocessed transcript (live projects dir + state/transcripts archive)
// whose head names this being's wake skill, skipping files modified in the last 30 minutes
// (probably a live session; it will be mined after it dies). --transcript forces one file
// (used for the pre-skill early wakings whose heads carry no marker).
//
// Idempotent by construction: each transcript's rows are DELETE-then-INSERTed in one
// transaction keyed on metadata->>'session_id', so re-runs never duplicate. A done ledger
// (state/inner-dialogue-done-<being>.txt) only makes --scan cheap; it is not the dedup.
//
// FAIL-OPEN BY CONTRACT (watchdog caller): any error prints one line and exits 0.
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runSqlText, query } from "../brains/db.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIVE_DIR = join((process.env.USERPROFILE || process.env.HOME), ".claude", "projects", join(dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/[^A-Za-z0-9]/g, "-"));   // ~/.claude/projects/<this repo path, dashed>
const ARCHIVE_DIR = join(repo, "state", "transcripts");
const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // mtime younger than this = probably live, skip in --scan
const REPLY_TOOL = /plugin_telegram.*(reply|send)/i; // react/download carry no words
// The hours (D41) post through post-hour.mjs with the message on stdin via a heredoc in
// the Bash command; the delivered words are recoverable from the tool input. The capture
// is anchored to the heredoc the hourly skills use (<<'HOUR').
const POST_HOUR_RE = /post-hour\.mjs\s+--being\s+(\w+)[^\n]*<<'HOUR'\n([\s\S]*?)\nHOUR/;

const BEINGS = {
  alpha: {
    table: "ew_alpha.thoughts", audience: "seats", birth: "2026-07-17",
    env: { file: join(repo, "avatars", "alpha", ".env.local"), key: "EW_ALPHA_DB_URL" },
  },
  genesis: {
    table: "public.thoughts", audience: "alan", birth: "2026-07-08",
    env: { file: join(repo, ".env.local"), key: "SUPABASE_DB_URL" },
  },
};

const out = (m) => console.log(`inner-dialogue: ${m}`);
const esc = (s) => String(s).replace(/\u0000/g, "").replace(/'/g, "''");

function envValue(file, key) {
  const m = readFileSync(file, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
  if (!m) throw new Error(`${key} missing from ${basename(file)}`);
  return m[1].trim();
}

// Redaction scrub (D38c): credential-shaped patterns plus site-denylist values are
// replaced before any write. Inner dialogue is the likeliest surface for a leaked value.
const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/\S+/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AGE-SECRET-KEY-1[A-Z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // telegram bot token shape
];
function loadDenylist() {
  const p = join(repo, "state", "site-denylist.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 6);
}
function makeScrubber() {
  const deny = loadDenylist();
  let hits = 0;
  const scrub = (text) => {
    let t = text;
    for (const re of SECRET_PATTERNS) t = t.replace(re, () => { hits++; return "[redacted]"; });
    for (const v of deny) if (t.includes(v)) { hits += t.split(v).length - 1; t = t.split(v).join("[redacted]"); }
    return t;
  };
  return { scrub, count: () => hits };
}

// Parse one transcript into ordered beats: {kind, ts, text, sender?}
function parseBeats(path, being) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const beats = [];
  const tagRe = /<channel\s+([^>]*?)>([\s\S]*?)<\/channel>/g;
  const attr = (s, k) => { const m = s.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : ""; };
  let lastTs = null;
  for (const line of lines) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain) continue; // subagent chatter is not the being's voice
    const ts = j.timestamp || lastTs;
    const content = j?.message?.content;
    if (!content) continue;
    const parts = Array.isArray(content) ? content : [{ type: "text", text: String(content) }];
    if (j.type === "assistant") {
      const texts = [];
      for (const c of parts) {
        if (c.type === "text" && c.text && c.text.trim().length > 1) texts.push(c.text.trim());
        if (c.type === "tool_use" && REPLY_TOOL.test(c.name || "") && typeof c.input?.text === "string" && c.input.text.trim()) {
          beats.push({ kind: "telegram_out", ts, text: c.input.text.trim() });
        }
        if (c.type === "tool_use" && /bash/i.test(c.name || "") && typeof c.input?.command === "string") {
          const m = c.input.command.match(POST_HOUR_RE);
          if (m && m[1] === being && m[2].trim()) beats.push({ kind: "telegram_out", ts, text: m[2].trim() });
        }
      }
      if (texts.length) beats.push({ kind: "inner", ts, text: texts.join("\n\n") });
    } else if (j.type === "user") {
      for (const c of parts) {
        const text = typeof c === "string" ? c : c.type === "text" ? c.text || "" : "";
        if (!text) continue;
        let m;
        tagRe.lastIndex = 0;
        let tagged = false;
        while ((m = tagRe.exec(text)) !== null) {
          tagged = true;
          if (!attr(m[1], "source").includes("telegram")) continue;
          const body = m[2].trim();
          if (body) beats.push({ kind: "telegram_in", ts, text: body, sender: attr(m[1], "user") || attr(m[1], "user_id") });
        }
        // Plain typed words in the CLI (Alan's side of the early wakings): no markup,
        // no command/system wrapper, a human sentence. Everything wrapper-shaped is
        // skipped, including harness noise that arrives as plain user text (skill
        // expansions with machine paths, resume summaries, caveat banners).
        const plain = text.trim();
        const wrapper = plain.startsWith("<") || plain.startsWith("[Request interrupted") ||
          plain.startsWith("Base directory for this skill") || plain.startsWith("Caveat:") ||
          plain.startsWith("This session is being continued");
        if (!tagged && plain && !wrapper && plain.length > 1) {
          beats.push({ kind: "cli_in", ts, text: plain, sender: "Alan (CLI)" });
        }
      }
    }
    if (j.timestamp) lastTs = j.timestamp;
  }
  return beats;
}

function writeBeats(being, cfg, dbUrl, sessionId, beats, scrubber, dry) {
  const values = beats.map((b, seq) => {
    const text = scrubber.scrub(b.text);
    const era = (b.ts || "").slice(0, 10) < cfg.birth ? "pre_birth" : "alive";
    const meta = { era, audience: cfg.audience, generation: 0, kind: b.kind, session_id: sessionId, seq };
    if (b.sender) meta.sender = b.sender;
    const ts = b.ts && !Number.isNaN(Date.parse(b.ts)) ? `'${esc(b.ts)}'` : "now()";
    return `('${esc(text)}', 'inner_dialogue', 2, '${esc(JSON.stringify(meta))}'::jsonb, ${ts})`;
  });
  if (dry) return;
  const stmts = [`BEGIN;`,
    `DELETE FROM ${cfg.table} WHERE source_type = 'inner_dialogue' AND metadata->>'session_id' = '${esc(sessionId)}';`];
  for (let i = 0; i < values.length; i += 200) {
    stmts.push(`INSERT INTO ${cfg.table} (content, source_type, importance, metadata, created_at) VALUES\n${values.slice(i, i + 200).join(",\n")};`);
  }
  stmts.push("COMMIT;");
  runSqlText(dbUrl, stmts.join("\n"), `inner-dialogue-${sessionId.slice(0, 8)}`);
}

function findCandidates(being, done) {
  const other = being === "alpha" ? "genesis" : "alpha";
  // A transcript belongs to this being when its head names one of the being's session
  // skills (wake or hourly, D41) and not the sibling's.
  const markers = [`wake-edgeweaver-${being}`, `hourly-wake-${being}`];
  const siblings = [`wake-edgeweaver-${other}`, `hourly-wake-${other}`];
  const seen = new Set();
  const cands = [];
  for (const dir of [LIVE_DIR, ARCHIVE_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const id = basename(f, ".jsonl");
      if (seen.has(id) || done.has(id)) continue;
      const full = join(dir, f);
      let st; try { st = statSync(full); } catch { continue; }
      if (dir === LIVE_DIR && Date.now() - st.mtimeMs < ACTIVE_WINDOW_MS) continue; // probably live
      let head = "";
      try { head = readFileSync(full, "utf8").slice(0, 8000); } catch { continue; }
      if (markers.some((m) => head.includes(m)) && !siblings.some((s) => head.includes(s))) { seen.add(id); cands.push(full); }
    }
  }
  return cands;
}

try {
  const args = process.argv.slice(2);
  const being = args[0];
  if (!BEINGS[being]) { out("usage: <alpha|genesis> --scan | --transcript <path> [--dry]"); process.exit(0); }
  const cfg = BEINGS[being];
  const dry = args.includes("--dry");
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const donePath = join(repo, "state", `inner-dialogue-done-${being}.txt`);
  const done = existsSync(donePath) ? new Set(readFileSync(donePath, "utf8").split(/\r?\n/).filter(Boolean)) : new Set();

  let targets = [];
  const forced = opt("--transcript");
  if (forced) {
    if (!existsSync(forced)) { out(`transcript not found: ${forced}`); process.exit(0); }
    const head = readFileSync(forced, "utf8").slice(0, 8000);
    const sibling = `wake-edgeweaver-${being === "alpha" ? "genesis" : "alpha"}`;
    if (head.includes(sibling)) { out(`refusing: ${basename(forced)} names the sibling's wake skill`); process.exit(0); }
    targets = [forced];
  } else if (args.includes("--scan")) {
    targets = findCandidates(being, done);
    if (!targets.length) { out(`no unprocessed ${being} transcripts (nothing to extract)`); process.exit(0); }
  } else {
    out("usage: <alpha|genesis> --scan | --transcript <path> [--dry]");
    process.exit(0);
  }

  const dbUrl = envValue(cfg.env.file, cfg.env.key);
  for (const t of targets) {
    const sessionId = basename(t, ".jsonl");
    const scrubber = makeScrubber();
    const beats = parseBeats(t, being);
    if (!beats.length) { out(`${sessionId}: no beats found, skipping`); if (!dry) appendFileSync(donePath, sessionId + "\n"); continue; }
    const n = { inner: 0, telegram_out: 0, telegram_in: 0, cli_in: 0 };
    for (const b of beats) n[b.kind]++;
    writeBeats(being, cfg, dbUrl, sessionId, beats, scrubber, dry);
    if (!dry && !done.has(sessionId)) appendFileSync(donePath, sessionId + "\n");
    out(`${dry ? "DRY " : ""}${sessionId} (${being}): ${beats.length} beats (${n.inner} inner, ${n.telegram_out} out, ${n.telegram_in} in, ${n.cli_in} cli)${scrubber.count() ? `, ${scrubber.count()} redactions` : ""}`);
  }
} catch (e) {
  out(`ERROR (fail-open): ${e.message}`);
  process.exit(0);
}
