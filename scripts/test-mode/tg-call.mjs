// tg-call.mjs - the "Call Genesis" button in Telegram (Alan, 2026-10-26: "implement both number one and
// number two for Genesis only to start"; then: "I'd like the call button to be able to be multi-party...
// it shows who's on the call... a message goes in letting you know who's joined the call and what time
// they joined the call. And when they leave the call... you can all talk to Edgeweaver together. Real time.")
//
// Shape: a Telegram Mini App (the bot's menu button opens our page inside Telegram). Telegram signs the
// page's initData with the bot's token, so the bridge KNOWS who opened it (not a caller-ID hint). A
// signed-in, allowlisted person gets a one-off Telnyx WebRTC credential and the page dials the being's
// own number: the call lands on the same party line as phone callers, so phone and Telegram people share
// one conference and one GPT-Live leg. Each credential is deleted when that person leaves.
//
// Env (.env.local): EW_CALL_BUTTON_<BEING>=on; EW_CALL_TELEGRAM_USERS_<BEING>="tgUserId=Name,..." (Genesis
// default: TELEGRAM_ALLOWED_USER_ID=Alan; D50 keeps Genesis's calls Alan-only until Alan widens it);
// TELNYX_WEBRTC_CONNECTION_ID; EW_PUBLIC_URL_<BEING> or the tunnel log (EW_TUNNEL_LOG_<BEING>) for the
// page address, re-read every minute so a new tunnel address re-points the button by itself.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { destination } from "./call-report.mjs";

const TELNYX = "https://api.telnyx.com/v2";
const ET = "America/New_York";
const SDK = "2.27.10"; // @telnyx/webrtc, pinned
const TITLE = { genesis: "Genesis", alpha: "Edgeweaver Alpha" };
const at = (t = Date.now()) => new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" }).format(new Date(t)) + " ET";

// Telegram Mini App initData: HMAC-SHA256 over the sorted fields, keyed by HMAC("WebAppData", bot token)
export function verifyInitData(initData, botToken, maxAgeS = 24 * 3600) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash"); if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const mine = createHmac("sha256", secret).update(dcs).digest();
  if (!timingSafeEqual(mine, Buffer.from(hash, "hex"))) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") || 0) > maxAgeS) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

export function createTgCall({ being, env, root, number, lineStatus, nameOf, log, activity }) {
  const B = being.toUpperCase();
  const enabled = env[`EW_CALL_BUTTON_${B}`] === "on" && !!env.TELNYX_WEBRTC_CONNECTION_ID;
  const botToken = being === "alpha" ? env.ALPHA_BOT_TOKEN : env.TELEGRAM_BOT_TOKEN;
  const allow = Object.fromEntries((env[`EW_CALL_TELEGRAM_USERS_${B}`] || (being === "genesis" && env.TELEGRAM_ALLOWED_USER_ID ? `${env.TELEGRAM_ALLOWED_USER_ID}=Alan` : ""))
    .split(",").map((s) => s.trim().split("=")).filter(([id]) => id).map(([id, name]) => [id, (name || "").trim() || "a member"]));
  const H = { Authorization: `Bearer ${env.TELNYX_API_KEY}`, "content-type": "application/json" };
  const web = new Map(); // sip username -> { name, tgId, credId, issuedAt }
  const tag = `ew-${being}-tg`;
  const userOf = (from) => String(from || "").replace(/^sip:/, "").split("@")[0];

  const tx = async (path, opts = {}) => {
    const r = await fetch(TELNYX + path, { headers: H, ...opts });
    const text = await r.text();
    if (!r.ok) throw new Error(`Telnyx ${opts.method || "GET"} ${path.split("?")[0]} -> ${r.status}: ${text.slice(0, 160)}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  const tg = (method, body) => fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json()).then((j) => { if (!j.ok) throw new Error(`Telegram ${method}: ${j.error_code} ${j.description}`); return j.result; });

  async function dropCredential(user) {
    const w = web.get(user); if (!w) return;
    web.delete(user);
    try { await tx(`/telephony_credentials/${w.credId}`, { method: "DELETE" }); log("tg-credential-deleted", { name: w.name }); }
    catch (e) { log("tg-credential-delete-failed", { error: e.message }); }
  }

  // one line in the being's chat (its report destination): who joined or left, when, and who is on now
  function announce(text) {
    const d = destination(being, env);
    if (!d.token || !d.chat) return;
    fetch(`https://api.telegram.org/bot${d.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: d.chat, text, disable_notification: false, ...(d.topic ? { message_thread_id: Number(d.topic) } : {}) }) })
      .then((r) => r.json()).then((j) => log(j.ok ? "tg-announced" : "tg-announce-failed", j.ok ? { text } : { error: j.description }))
      .catch((e) => log("tg-announce-failed", { error: e.message }));
  }
  const onNow = (humans) => humans.length ? humans.map((h) => nameOf(h.from).name).join(", ") : "nobody";

  // the menu button follows the page's public address (a quick tunnel changes it on every restart)
  let lastUrl = null;
  async function publicBase() {
    if (env[`EW_PUBLIC_URL_${B}`]) return env[`EW_PUBLIC_URL_${B}`].replace(/\/$/, "");
    const logFile = env[`EW_TUNNEL_LOG_${B}`] || join(root, "logs", "voice", being === "genesis" ? "tunnel-console.log" : `tunnel-${being}.log`);
    const m = (await readFile(logFile, "utf8").catch(() => "")).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    return m ? m.at(-1) : null;
  }
  async function pointButton() {
    const base = await publicBase(); if (!base) return;
    const url = `${base}/tg`;
    if (url === lastUrl) return;
    // every allowed person's private chat; one that fails (they never started the bot) skips only itself
    let ok = 0;
    for (const chat of Object.keys(allow)) {
      try { await tg("setChatMenuButton", { chat_id: Number(chat), menu_button: { type: "web_app", text: `Call ${TITLE[being]}`, web_app: { url } } }); ok++; }
      catch (e) { log("tg-button-failed", { name: allow[chat], error: e.message }); }
    }
    if (ok) { lastUrl = url; log("tg-button-pointed", { url, people: ok }); }
  }

  async function sweep() { // credentials left by a bridge that stopped mid-call
    try {
      const j = await tx(`/telephony_credentials?filter[tag]=${encodeURIComponent(tag)}&page[size]=100`);
      for (const c of j.data || []) if (![...web.values()].some((w) => w.credId === c.id)) await tx(`/telephony_credentials/${c.id}`, { method: "DELETE" }).catch(() => {});
    } catch (e) { log("tg-sweep-failed", { error: e.message }); }
  }

  const who = (body) => {
    const u = verifyInitData(body?.initData, botToken);
    if (!u) return { error: [401, "not signed in through Telegram"] };
    const name = allow[String(u.id)];
    if (!name) return { error: [403, "this call is not open to you yet"] };
    return { user: u, name };
  };

  return {
    enabled,
    allows: (from) => web.has(userOf(from)),
    nameOf: (from) => { const w = web.get(userOf(from)); return w ? { name: w.name, via: "telegram" } : null; },

    start() {
      if (!enabled) return;
      sweep(); pointButton(); setInterval(pointButton, 60 * 1000).unref();
      log("tg-call-armed", { people: Object.keys(allow).length });
    },

    onRoster(count, info, humans) {
      if (!enabled) return;
      if (info.joined) {
        const n = nameOf(info.joined);
        if (n.via === "telegram") log("caller-named", { from: info.joined, name: n.name, via: "telegram" }); // so the call report can name them
        announce(`${n.name} joined the call with ${TITLE[being]} at ${at()}${n.via === "telegram" ? " (Telegram)" : n.via === "phone" ? " (phone)" : ""}. On the call now: ${onNow(humans)}.`);
      } else if (info.left) {
        const n = nameOf(info.left);
        announce(`${n.name} left the call at ${at()}. On the call now: ${onNow(humans)}${humans.length ? "" : "; the call has ended"}.`);
        if (web.has(userOf(info.left))) dropCredential(userOf(info.left));
      }
    },

    // routes: GET /tg (the page), POST /api/tg/join, POST /api/tg/roster. Returns true when handled.
    async handle(req, res, url, readBody, json, page) {
      if (!url.pathname.startsWith("/tg") && !url.pathname.startsWith("/api/tg/")) return false;
      if (!enabled) { json(res, 404, { error: "not found" }); return true; }
      if (req.method === "GET" && url.pathname === "/tg") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(page.replaceAll("__TITLE__", TITLE[being]).replaceAll("__SDK__", SDK));
        return true;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const w = who(body);
      if (w.error) { json(res, w.error[0], { error: w.error[1] }); return true; }
      if (req.method === "POST" && url.pathname === "/api/tg/join") {
        // one person, one live credential: a second tap replaces the first
        for (const [user, x] of web) if (x.tgId === String(w.user.id)) await dropCredential(user);
        const cred = (await tx("/telephony_credentials", { method: "POST", body: JSON.stringify({ connection_id: env.TELNYX_WEBRTC_CONNECTION_ID, name: `${tag}-${w.user.id}`, tag }) })).data;
        const token = await tx(`/telephony_credentials/${cred.id}/token`, { method: "POST" });
        web.set(cred.sip_username, { name: w.name, tgId: String(w.user.id), credId: cred.id, issuedAt: Date.now() });
        setTimeout(() => { const x = web.get(cred.sip_username); if (x && !lineStatus().humans.some((h) => userOf(h.from) === cred.sip_username)) dropCredential(cred.sip_username); }, 10 * 60 * 1000).unref();
        log("tg-join", { name: w.name });
        json(res, 200, { token: String(token).trim(), number, name: w.name });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/api/tg/event") { // the page's own steps and errors
        log("tg-client", { name: w.name, step: String(body.step || "").slice(0, 40), detail: String(body.detail || "").slice(0, 300), ua: String(req.headers["user-agent"] || "").slice(0, 120) });
        json(res, 200, { ok: true });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/api/tg/roster") {
        const s = lineStatus();
        json(res, 200, { me: w.name, live: !!s.ai?.answered, activity: s.ai?.answered ? activity?.() ?? null : null, people: s.humans.map((h) => ({ ...nameOf(h.from), since: h.since })) });
        return true;
      }
      json(res, 404, { error: "not found" });
      return true;
    },
  };
}
