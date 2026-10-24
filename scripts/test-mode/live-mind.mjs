// live-mind.mjs - TEST MODE: persistent Claude Code session as a streaming voice mind on the
// SUBSCRIPTION (no API credits). One process per model stays alive across turns
// (--input-format stream-json); replies stream token-by-token (--include-partial-messages) and are
// emitted SENTENCE BY SENTENCE so TTS can start on sentence one while the rest generates.
// Latency levers (measured 2026-07-07, warm turns): --tools none + custom system prompt shrink the
// prompt ~22k -> ~360 tokens; MAX_THINKING_TOKENS=0 removes the think-before-speak delay.
// --strict-mcp-config (2026-10-24): skips user MCP servers and plugin servers (the telegram plugin
// cost ~7 s of cold start and would start a poller on the default bot); 16.0 s -> 9.0 s measured.
// v2 (2026-07-08): real FIFO turn queue, true interrupt (control_request) so a barged turn frees
// the session immediately instead of silently blocking the next question, error results surface
// as rejections instead of empty silence, and a per-turn watchdog timeout.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveClaude } from "../../voice/claude-backend.mjs";

const TURN_TIMEOUT_MS = 45000;

export class LiveMind {
  constructor(model, systemPrompt, opts = {}) {
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.opts = { effort: "low", thinking: false, timeoutMs: TURN_TIMEOUT_MS, ...opts }; // deep minds: effort high + thinking on
    this.proc = null;
    this.buf = "";
    this.sessionId = null; // Claude Code session id (from stream-json events) - lets the voice
                           // transcript log cross-reference ~/.claude/projects/ session files
    this.current = null;   // { onSentence, resolve, reject, pending, full, warmup, timer }
    this.queue = [];       // waiting turns: { text, onSentence, resolve, reject }
  }

  start() {
    if (this.proc) return;
    this.sessionId = null; // a respawned process is a new Claude session
    this.proc = spawn(resolveClaude(), [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json",
      "--include-partial-messages", "--verbose",
      "--model", this.model,
      "--effort", this.opts.effort,
      "--tools", "none",
      "--strict-mcp-config",
      "--exclude-dynamic-system-prompt-sections",
      "--system-prompt", this.systemPrompt,
    ], { shell: false, env: this.opts.thinking ? { ...process.env } : { ...process.env, MAX_THINKING_TOKENS: "0" } });
    this.proc.stdout.on("data", (d) => this.#onData(d));
    this.proc.stderr.on("data", () => { /* errors surface via result events */ });
    this.proc.on("exit", () => {
      this.proc = null;
      const err = new Error("mind session exited");
      if (this.current) { this.#finish("reject", err); }
      for (const q of this.queue.splice(0)) q.reject(err);
    });
    // warmup turn: pays the cold-start cost now so the first real turn is warm
    this.current = { warmup: true, resolve: () => {}, reject: () => {}, onSentence: () => {}, pending: "", full: "" };
    this.#send("(warmup) Reply with just: ok");
  }

  #send(text) {
    this.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
  }

  // finish the current turn (resolve/reject), then start the next queued one
  #finish(kind, value) {
    const cur = this.current;
    if (!cur) return;
    if (cur.timer) clearTimeout(cur.timer);
    this.current = null;
    try { kind === "resolve" ? cur.resolve(value) : cur.reject(value); } catch { /* consumer gone */ }
    const next = this.queue.shift();
    if (next) this.#fire(next);
  }

  #fire(turn) {
    this.start();
    turn.pending = ""; turn.full = "";
    turn.timer = setTimeout(() => this.#finish("reject", new Error(`mind timeout after ${this.opts.timeoutMs / 1000}s`)), this.opts.timeoutMs);
    this.current = turn;
    this.#send(turn.text);
  }

  #onData(d) {
    this.buf += d.toString();
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.session_id && !this.sessionId) this.sessionId = e.session_id;
      const cur = this.current;
      if (!cur) continue;
      if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event?.delta?.type === "text_delta") {
        cur.pending += e.event.delta.text;
        cur.full += e.event.delta.text;
        let m;
        while ((m = cur.pending.match(/^(.*?[.!?])(\s+|$)/s))) {
          const sentence = m[1].trim();
          cur.pending = cur.pending.slice(m[0].length);
          if (sentence && !cur.warmup && !cur.interrupted) cur.onSentence(sentence);
        }
      } else if (e.type === "result") {
        const failed = e.is_error || (e.subtype && e.subtype !== "success");
        if (failed && !cur.warmup && !cur.interrupted) {
          this.#finish("reject", new Error(`mind result: ${e.subtype || "error"}${e.result ? " - " + String(e.result).slice(0, 120) : ""}`));
        } else {
          const tail = cur.pending.trim();
          if (tail && !cur.warmup && !cur.interrupted) cur.onSentence(tail);
          this.#finish("resolve", cur.full.trim());
        }
      }
    }
  }

  // ask(text, onSentence) -> resolves with the full reply. FIFO-queued behind any in-flight turn.
  // start() FIRST: on a cold (lazy-started) mind this makes the warmup the current turn so the real
  // ask queues behind it. Without it, start()'s warmup and this turn were both written to the
  // process at once and the warmup's "ok" was returned as the answer to the real question.
  ask(text, onSentence) {
    return new Promise((resolve, reject) => {
      const turn = { text, onSentence, resolve, reject };
      this.start();
      if (this.current) this.queue.push(turn);
      else this.#fire(turn);
    });
  }

  // interrupt(): a barge makes EVERYTHING stale - flush queued turns and abort the in-flight one.
  // Uses the CLI's control_request; the interrupted turn still emits a result, which #finish eats.
  interrupt() {
    for (const q of this.queue.splice(0)) { try { q.reject(new Error("interrupted")); } catch { /* consumer gone */ } }
    if (!this.proc || !this.current || this.current.warmup) return;
    this.current.interrupted = true; // stop emitting its sentences either way
    try {
      this.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } }) + "\n");
    } catch { /* session may be mid-exit; watchdog will clean up */ }
  }

  stop() { try { this.proc?.kill(); } catch { /* fine */ } this.proc = null; }
}
