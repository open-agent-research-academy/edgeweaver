#!/usr/bin/env node
// Local Bot-API shim (D33/CR-3): serves getUpdates FROM the cloud journal and passes
// every other Bot API call through to api.telegram.org. The forked plugin points
// TELEGRAM_API_ROOT here once the bot is in webhook mode (Telegram refuses getUpdates
// while a webhook is set, which also structurally ends the stray-poller hijack class).
//
//   node scripts/ops/telegram-shim.mjs --being alpha --port 8471
//
// Loopback only. The bot token appears in request PATHS (Bot API shape); nothing here
// logs a path unredacted. Reads EW_JOURNAL_READER_URL from the repo .env.local; keeps a
// per-being confirmed-cursor file in state/ mirroring Telegram's offset semantics
// (offset=X confirms everything below X and returns from X on). Polls the journal by
// spawning psql (db.mjs) about every 1.5s while a long-poll is waiting - light, and the
// journal read role can do nothing but SELECT on ew_ops.channel_journal.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { query } = await import("file:///" + join(repo, "scripts", "brains", "db.mjs").replace(/\\/g, "/"));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BEING = opt("--being");
const PORT = parseInt(opt("--port", "0"), 10);
if (!["alpha", "genesis"].includes(BEING) || !PORT) { console.error("usage: --being <alpha|genesis> --port <n>"); process.exit(1); }

const env = {};
for (const l of readFileSync(join(repo, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\r$/, "");
}
const READER = env.EW_JOURNAL_READER_URL;
if (!READER) { console.error("EW_JOURNAL_READER_URL missing in .env.local (run channel-journal-setup.mjs)"); process.exit(1); }

const CURSOR_FILE = join(repo, "state", `telegram-shim-cursor-${BEING}.txt`);
let cursor = 0; // lowest update_id NOT yet confirmed
try { if (existsSync(CURSOR_FILE)) cursor = parseInt(readFileSync(CURSOR_FILE, "utf8"), 10) || 0; } catch {}
const saveCursor = () => { try { writeFileSync(CURSOR_FILE, String(cursor)); } catch {} };

const redact = (p) => p.replace(/\/bot[^/]+/, "/bot<token>").replace(/\/file\/bot[^/]+/, "/file/bot<token>");
const log = (m) => process.stderr.write(`telegram-shim[${BEING}]: ${m}\n`);

function readJournal(fromId, limit) {
  // b64 travel for content (the db.mjs psql parser splits on lines and pipes).
  const rows = query(READER,
    `SELECT replace(encode(convert_to(update::text, 'UTF8'), 'base64'), E'\n', '')
       FROM ew_ops.channel_journal
      WHERE being = '${BEING}' AND (update->>'update_id')::bigint >= ${fromId}
      ORDER BY (update->>'update_id')::bigint
      LIMIT ${limit}`);
  return rows.map((r) => JSON.parse(Buffer.from(r[0], "base64").toString("utf8")));
}

async function handleGetUpdates(params, res) {
  const offset = parseInt(params.offset ?? "0", 10);
  const limit = Math.min(parseInt(params.limit ?? "100", 10) || 100, 100);
  const timeoutS = Math.min(parseInt(params.timeout ?? "0", 10) || 0, 50);
  if (offset > cursor) { cursor = offset; saveCursor(); }
  const from = Math.max(offset, cursor);
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    let updates = [];
    try { updates = readJournal(from, limit); }
    catch (e) { log(`journal read failed: ${String(e.message).slice(0, 120)}`); }
    if (updates.length > 0 || Date.now() >= deadline) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: updates }));
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function passthrough(req, res, bodyBuf) {
  const target = "https://api.telegram.org" + req.url;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] ?? "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : bodyBuf,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "application/json" });
    res.end(buf);
  } catch (e) {
    log(`passthrough failed for ${redact(req.url.split("?")[0])}: ${e.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error_code: 502, description: "shim passthrough failed" }));
  }
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const bodyBuf = Buffer.concat(chunks);
    const [path, qs] = req.url.split("?");
    const m = path.match(/^\/bot[^/]+\/(\w+)$/);
    if (m && m[1] === "getUpdates") {
      // Params arrive as query string or JSON body depending on the client; grammY POSTs JSON.
      let params = Object.fromEntries(new URLSearchParams(qs ?? ""));
      if (bodyBuf.length) { try { params = { ...params, ...JSON.parse(bodyBuf.toString("utf8")) }; } catch {} }
      handleGetUpdates(params, res);
      return;
    }
    passthrough(req, res, bodyBuf.length ? bodyBuf : undefined);
  });
});
server.listen(PORT, "127.0.0.1", () => log(`listening on 127.0.0.1:${PORT}, cursor=${cursor}`));
