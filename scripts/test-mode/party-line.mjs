// party-line.mjs - the phone side of the GPT-Live bridge as a PARTY LINE (Alan, 2026-10-23:
// "multiple people can call in simultaneously ... if a second person calls the number, it makes it
// a party line").
//
// Shape: the number belongs to a Telnyx Call Control application whose webhooks land here. Every
// human caller is answered and put into one Telnyx conference. The first human's arrival also dials
// ONE outbound SIP leg from that conference to OpenAI (sip:proj_...@sip.api.openai.com, TLS + SRTP);
// OpenAI then fires live.transport.incoming at the bridge, which accepts and attaches the mind as
// for any SIP call. So GPT-Live hears everyone in the room and everyone hears it: one GPT-Live
// session ($0.05/min) however many people are on the line. A second caller hears a short beep on
// entry and the mind is told someone joined. When the last human hangs up, the AI leg is hung up
// too (that ends the GPT-Live session and its meter) and the conference is closed.
//
// Telnyx webhook authenticity: Ed25519 over `${telnyx-timestamp}|${raw body}` with the account's
// public key (portal: Account > Keys & Credentials > Public Key; base64, 32 bytes), 5-minute tolerance.
// This module never logs secrets; the API key is held in memory from .env.local only.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const TELNYX = "https://api.telnyx.com/v2";
const OPENAI_SIP_HOST = "sip.api.openai.com";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // DER header for a raw Ed25519 public key

export function verifyTelnyx(headers, rawBody, publicKeyB64, toleranceSec = 300) {
  const sig = headers["telnyx-signature-ed25519"], ts = headers["telnyx-timestamp"];
  if (!sig || !ts || !publicKeyB64) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  let raw; try { raw = Buffer.from(String(publicKeyB64).trim(), "base64"); } catch { return false; }
  if (raw.length !== 32) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    const signature = Buffer.from(String(sig), "base64");
    if (signature.length !== 64) return false;
    return cryptoVerify(null, Buffer.from(`${ts}|${rawBody}`, "utf8"), key, signature);
  } catch { return false; }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s) => { try { return JSON.parse(Buffer.from(String(s || ""), "base64").toString("utf8")); } catch { return {}; } };

export class PartyLine {
  /**
   * @param {object} o
   * @param {string} o.apiKey Telnyx API key
   * @param {string} o.appId Telnyx Call Control application id (the number's connection)
   * @param {string} o.number our Telnyx number, E.164 (caller id of the AI leg)
   * @param {string} o.openaiProjectId proj_... (the SIP user at OpenAI)
   * @param {(type:string, data?:object)=>void} [o.log]
   * @param {(count:number, info:object)=>void} [o.onRoster] called when the human count changes
   * @param {(reason:string)=>void} [o.onEnd] called when the line closes, so the bridge can end its session
   */
  constructor({ apiKey, appId, number, openaiProjectId, log, onRoster, onEnd, beep = "on_enter", aiRedials = 2, confirmViaApi = false, allowedCallers = [], allowCaller = () => false }) {
    Object.assign(this, { apiKey, appId, number, openaiProjectId, beep, aiRedials, confirmViaApi, allowedCallers, allowCaller });
    this.log = log || ((t, d) => console.log("[line]", t, d ? JSON.stringify(d) : ""));
    this.onRoster = onRoster || (() => {});
    this.onEnd = onEnd || (() => {});
    this.reset();
  }

  reset() {
    this.humans = new Map();   // call_control_id -> { from, answeredAt }
    this.pending = new Map();  // call_control_id -> { from, initiatedAt } (answered not yet confirmed)
    this.ai = null;            // { ccid, dialedAt, answeredAt, redials }
    this.conference = null;    // { id, name, createdAt }
    this.redials = 0;
    this.lineStartedAt = null;
  }

  status() {
    return { humans: [...this.humans.values()].map((h) => ({ from: h.from, since: h.answeredAt })), ai: this.ai ? { answered: !!this.ai.answered, since: this.ai.dialedAt } : null,
      conference: this.conference ? { id: this.conference.id, name: this.conference.name } : null, lineStartedAt: this.lineStartedAt };
  }

  async api(path, body, method = "POST") {
    const r = await fetch(TELNYX + path, { method, headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!r.ok) throw new Error(`Telnyx ${method} ${path} -> ${r.status}: ${(j?.errors || []).map((e) => `${e.code || ""} ${e.title || ""} ${e.detail || ""}`.trim()).join("; ") || text.slice(0, 200)}`);
    return j;
  }

  // Without the account's public key (not offered at every Telnyx account level), authenticity comes
  // from asking Telnyx about the call itself: a forged event names a call that does not exist or is
  // not in the claimed state. Costs one GET per event; fine at party-line volumes.
  async confirm(t, p) {
    if (!this.confirmViaApi || !p.call_control_id) return true;
    try {
      const j = await this.api(`/calls/${encodeURIComponent(p.call_control_id)}`, undefined, "GET");
      const alive = j?.data?.is_alive;
      if (t === "call.hangup") return alive === false;
      if (t === "call.initiated" || t === "call.answered") return alive === true;
      return true;
    } catch (e) { this.log("confirm-failed", { event: t, error: String(e.message || e) }); return false; }
  }

  // Telnyx webhook `data` object: { event_type, payload: {...} }
  async handle(data) {
    const t = data?.event_type, p = data?.payload || {};
    const role = unb64(p.client_state).role;
    if (/^call\./.test(t) && !(await this.confirm(t, p))) { this.log("unconfirmed-event-dropped", { event: t }); return; }
    try {
      switch (t) {
        case "call.initiated":
          if (p.direction !== "incoming") return;
          if (p.to && p.to !== this.number) return; // one app carries every being's number; answer only our own

          // an armed being's line is pinned to its callers (Alan-only until the village opens); unknown numbers never reach it
          // (allowCaller: a Telegram call-button credential the bridge issued to a signed-in person)
          if (this.allowedCallers.length && !this.allowedCallers.includes(p.from) && !this.allowCaller(p.from)) {
            this.log("caller-refused", { from: p.from });
            await this.api(`/calls/${p.call_control_id}/actions/reject`, { cause: "CALL_REJECTED" });
            return;
          }
          this.pending.set(p.call_control_id, { from: p.from, initiatedAt: Date.now() });
          this.log("caller-ringing", { from: p.from });
          await this.api(`/calls/${p.call_control_id}/actions/answer`, { client_state: b64({ role: "human" }), command_id: `ans_${p.call_control_id.slice(-8)}` });
          return;
        case "call.answered":
          if (role === "ai") { if (this.ai && this.ai.ccid === p.call_control_id) { this.ai.answered = true; this.ai.answeredAt = Date.now(); } this.log("ai-leg-answered", { ms: this.ai ? Date.now() - this.ai.dialedAt : null }); return; }
          if (role !== "human") return;
          {
            const pend = this.pending.get(p.call_control_id) || { from: p.from };
            this.pending.delete(p.call_control_id);
            this.humans.set(p.call_control_id, { from: pend.from || p.from, answeredAt: Date.now() });
            if (!this.lineStartedAt) this.lineStartedAt = Date.now();
            this.log("caller-answered", { from: pend.from || p.from, humans: this.humans.size });
            await this.ensureConference(p.call_control_id);
            await this.ensureAiLeg();
            this.onRoster(this.humans.size, { joined: pend.from || p.from, humans: this.status().humans });
          }
          return;
        case "call.hangup":
          if (role === "ai" || (this.ai && this.ai.ccid === p.call_control_id)) {
            this.log("ai-leg-hangup", { cause: p.hangup_cause, source: p.hangup_source, humans: this.humans.size });
            const lasted = this.ai ? Date.now() - this.ai.dialedAt : 0; this.ai = null;
            if (this.humans.size > 0) {
              if (lasted > 15000 && this.redials < this.aiRedials) { this.redials++; this.log("ai-leg-redial", { attempt: this.redials }); await this.ensureAiLeg(); }
              else await this.endLine("ai leg lost");
            } else await this.endLine("empty");
            return;
          }
          if (this.humans.delete(p.call_control_id) || this.pending.delete(p.call_control_id)) {
            this.log("caller-hangup", { from: p.from, cause: p.hangup_cause, humans: this.humans.size });
            this.onRoster(this.humans.size, { left: p.from, humans: this.status().humans });
            if (this.humans.size === 0) await this.endLine("last caller left");
          }
          return;
        case "conference.created":
          if (this.conference && p.conference_id && !this.conference.id) this.conference.id = p.conference_id;
          this.log("conference-created", { id: p.conference_id });
          return;
        case "conference.participant.joined":
        case "conference.participant.left":
          this.log(t.replace("conference.", "conf-"), { ccid: (p.call_control_id || "").slice(-8), role });
          // 10-25 13:19: a caller left the conference and no call.hangup ever reached us, so the line
          // stayed open and the call never ended (no episode). A human leaving counts as hanging up.
          if (t === "conference.participant.left" && this.humans.has(p.call_control_id)) {
            const h = this.humans.get(p.call_control_id); this.humans.delete(p.call_control_id);
            this.log("caller-hangup", { from: h.from, cause: "left conference", humans: this.humans.size });
            this.onRoster(this.humans.size, { left: h.from, humans: this.status().humans });
            if (this.humans.size === 0) await this.endLine("last caller left");
          }
          return;
        case "conference.ended":
          this.log("conference-ended", { reason: p.reason });
          if (this.conference && (!p.conference_id || p.conference_id === this.conference.id)) { if (this.ai) { try { await this.api(`/calls/${this.ai.ccid}/actions/hangup`, {}); } catch { /* fine */ } } this.reset(); }
          return;
        default:
          if (t && !/\.(speak|playback|dtmf|recording|machine)\./.test(t)) this.log("event", { of: t });
      }
    } catch (e) {
      this.log("line-error", { event: t, error: String(e.message || e) });
    }
  }

  async ensureConference(humanCcid) {
    if (!this.conference) {
      const name = `edgeweaver-line-${Date.now().toString(36)}`;
      const j = await this.api("/conferences", { call_control_id: humanCcid, name, beep_enabled: this.beep, start_conference_on_create: true, comfort_noise: false });
      this.conference = { id: j?.data?.id, name, createdAt: Date.now() };
      this.log("conference-opened", { name, id: this.conference.id });
    } else {
      await this.api(`/conferences/${this.conference.id}/actions/join`, { call_control_id: humanCcid, start_conference_on_enter: true, end_conference_on_exit: false, beep_enabled: this.beep });
      this.log("caller-joined-line", { humans: this.humans.size });
    }
  }

  async ensureAiLeg() {
    if (this.ai || !this.conference) return;
    const to = `sip:${this.openaiProjectId}@${OPENAI_SIP_HOST}:5061;transport=tls`;
    const j = await this.api("/calls", {
      connection_id: this.appId, to, from: this.number, sip_transport_protocol: "TLS", media_encryption: "SRTP", timeout_secs: 30,
      client_state: b64({ role: "ai" }), command_id: `ai_${this.conference.name}`,
      conference_config: { conference_name: this.conference.name, start_conference_on_enter: true, end_conference_on_exit: false },
    });
    this.ai = { ccid: j?.data?.call_control_id, dialedAt: Date.now(), answered: false };
    this.log("ai-leg-dialed", { to: `sip:${this.openaiProjectId.slice(0, 9)}...@${OPENAI_SIP_HOST}` });
  }

  async endLine(reason) {
    this.log("line-closing", { reason, seconds: this.lineStartedAt ? Math.round((Date.now() - this.lineStartedAt) / 1000) : 0 });
    const { ai, conference } = this; this.reset();
    try { this.onEnd(reason); } catch { /* the bridge's problem, not the line's */ }
    if (ai) { try { await this.api(`/calls/${ai.ccid}/actions/hangup`, {}); } catch (e) { this.log("ai-hangup-failed", { error: e.message }); } }
    if (conference?.id) { try { await this.api(`/conferences/${conference.id}/actions/end`, {}); } catch { /* already gone */ } }
  }

  async shutdown() { if (this.humans.size || this.ai || this.conference) await this.endLine("shutdown"); }
}
