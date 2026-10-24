#!/usr/bin/env node
// Dead-letter extractor (channel-recovery plan Tier 1, D33 / gate CR-1).
// When a channel session dies (DEAF / FROZEN / machine-dark), the messages it received
// but never answered are still in its transcript on disk. This script mines the victim
// transcript and writes them to state/channel-deadletter-<being>.json so the fresh
// session can answer them itself (wake skill section 2c). Proven feasible 2026-07-27:
// Marina's lost first hello was fully readable in the dead transcript.
//
// Usage:
//   node scripts/ops/channel-deadletter.mjs <alpha|genesis> [--transcript <path>] [--out <path>] [--dry]
// Called by both watchdogs before every relaunch EXCEPT closed-session relaunches (a
// deliberate close answered its conversation by definition).
//
// FAIL-OPEN BY CONTRACT: any error prints one line and exits 0; a broken extractor must
// never block a relaunch. Answered-detection is deliberately simple (v1): an inbound is
// unanswered when NO later assistant turn used a telegram reply/react/send tool. That
// exactly covers the observed loss shape (session dies holding the tail of the
// conversation); a mid-session skip followed by later replies would be missed - named
// limit, journal tier (CR-2) supersedes this parsing entirely.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRANSCRIPT_DIR = join((process.env.USERPROFILE || process.env.HOME), ".claude", "projects", join(dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/[^A-Za-z0-9]/g, "-"));
const MAX_VICTIM_AGE_DAYS = 7;
const REPLY_TOOL = /plugin_telegram.*(reply|react|send)/i;

function out(msg) { console.log(`deadletter: ${msg}`); }

try {
  const args = process.argv.slice(2);
  const being = args[0];
  if (being !== "alpha" && being !== "genesis") { out("usage: <alpha|genesis>"); process.exit(0); }
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const dry = args.includes("--dry");
  const outPath = opt("--out") || join(repo, "state", `channel-deadletter-${being}.json`);
  const donePath = join(repo, "state", `channel-deadletter-done-${being}.txt`);
  const marker = `wake-edgeweaver-${being}`;
  const sibling = `wake-edgeweaver-${being === "alpha" ? "genesis" : "alpha"}`;

  // 1. Locate the victim transcript: newest .jsonl whose HEAD names this being's wake
  // skill (the sibling being's transcripts live in the same dir), young enough to be the
  // just-killed session, and not already extracted (a startup-death relaunch loop must
  // not resurrect letters an earlier fresh session already answered).
  let victim = opt("--transcript");
  if (!victim) {
    const done = existsSync(donePath) ? new Set(readFileSync(donePath, "utf8").split(/\r?\n/)) : new Set();
    const cands = readdirSync(TRANSCRIPT_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f: join(TRANSCRIPT_DIR, f), m: statSync(join(TRANSCRIPT_DIR, f)).mtimeMs }))
      .filter((c) => Date.now() - c.m < MAX_VICTIM_AGE_DAYS * 864e5)
      .sort((a, b) => b.m - a.m);
    for (const c of cands) {
      if (done.has(basename(c.f, ".jsonl"))) continue;
      let head = "";
      try { head = readFileSync(c.f, "utf8").slice(0, 8000); } catch { continue; }
      if (head.includes(marker) && !head.includes(sibling)) { victim = c.f; break; }
      // Resumed/compacted transcripts may lack the command line; accept a head that
      // mentions only this being's skill anywhere in the first lines.
    }
  }
  if (!victim || !existsSync(victim)) { out(`no ${being} victim transcript found (nothing to recover)`); process.exit(0); }
  const victimId = basename(victim, ".jsonl");

  // 2. Parse: collect inbound channel turns and the position of the last reply-ish tool use.
  const lines = readFileSync(victim, "utf8").split(/\r?\n/).filter(Boolean);
  const inbound = []; // {idx, chat_id, message_id, user_id, name, ts, text}
  let lastReplyIdx = -1;
  const tagRe = /<channel\s+([^>]*?)>([\s\S]*?)<\/channel>/g;
  const attr = (s, k) => { const m = s.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : ""; };
  lines.forEach((line, idx) => {
    let j; try { j = JSON.parse(line); } catch { return; }
    const content = j?.message?.content;
    if (!content) return;
    const parts = Array.isArray(content) ? content : [{ type: "text", text: String(content) }];
    for (const c of parts) {
      if (j.type === "user" && (c.type === "text" || typeof c === "string")) {
        const text = typeof c === "string" ? c : c.text || "";
        let m;
        tagRe.lastIndex = 0;
        while ((m = tagRe.exec(text)) !== null) {
          const a = m[1];
          if (!attr(a, "source").includes("telegram")) continue;
          inbound.push({
            idx, chat_id: attr(a, "chat_id"), message_id: attr(a, "message_id"),
            user_id: attr(a, "user_id"), name: attr(a, "user"), ts: attr(a, "ts"),
            text: m[2].trim(),
          });
        }
      }
      if (j.type === "assistant" && c.type === "tool_use" && REPLY_TOOL.test(c.name || "")) lastReplyIdx = idx;
    }
  });

  // 3. Unanswered = inbound after the last reply-ish tool use.
  const unanswered = inbound.filter((i) => i.idx > lastReplyIdx);
  if (unanswered.length === 0) { out(`${victimId}: ${inbound.length} inbound, all answered - no dead letters`); process.exit(0); }

  // 4. Resolve seat names (Alpha: channel-policy.json; both: keep the transcript's own
  // display name when the id resolves nowhere - never leave a bare numeric id alone).
  let seats = {};
  try {
    const pol = JSON.parse(readFileSync(join(repo, "avatars", being, "state", "channel-policy.json"), "utf8"));
    seats = pol.seats || {};
  } catch { /* genesis has no policy file; display names carry it */ }
  for (const u of unanswered) {
    const seat = seats[u.user_id];
    if (seat && seat.name) u.name = seat.name;
    else if (u.name === u.user_id) u.name = `unknown sender (id ${u.user_id})`;
  }

  // 5. Merge with any existing unconsumed dead-letter file (dedupe chat_id+message_id).
  let existing = [];
  try { if (existsSync(outPath)) existing = JSON.parse(readFileSync(outPath, "utf8")).messages || []; } catch {}
  const key = (m) => `${m.chat_id}/${m.message_id}`;
  const seen = new Set(existing.map(key));
  const merged = existing.concat(unanswered.filter((m) => !seen.has(key(m))).map(({ idx, ...m }) => ({ ...m, victim_session: victimId })));

  if (dry) { out(`DRY ${victimId}: ${merged.length} dead letter(s): ${merged.map((m) => `${m.name} msg ${m.message_id}`).join("; ")}`); process.exit(0); }
  writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), being, messages: merged }, null, 2) + "\n");
  appendFileSync(donePath, victimId + "\n");
  out(`${victimId}: wrote ${merged.length} dead letter(s) to ${basename(outPath)}: ${merged.map((m) => `${m.name} msg ${m.message_id}`).join("; ")}`);
} catch (e) {
  out(`ERROR (fail-open, relaunch proceeds): ${e.message}`);
  process.exit(0);
}
