// being-memory.mjs - a being's memory on the voice line (D50: calls become real memories).
//
// orient()     the wake skill's orientation (scripts/waking/orient.mjs), cached and refreshed every
//              2 minutes so a call never waits the ~3.5 s it takes; the opening line speaks it.
// recall(q)    episodic recall through the scoped wrapper (recall-scoped, audience alan), the same
//              call the wake skill makes; weak hits dropped, each clipped.
// writeEpisode({content, importance})   one edgeweaver_episode row, surface "voice", then
//              embed-backfill, then read back by id (the unverified-write edge: a write is not
//              done until the read-back proves it).
// Modes (EW_GPTLIVE_MEMORY): "live" writes era alive; "rehearsal" writes era rehearsal with
// rehearsal=true and an nl-rehearsal-* run_id and deletes the row right after the read-back
// (PREBUILD convention; the committed recall-scoped wrapper does not filter rehearsal rows);
// "off" (default) reads nothing and writes nothing.
import { execFile } from "node:child_process";

const SURFACE = "voice";
const MIN_SIMILARITY = 0.40; // spoken questions score ~0.42 against the right episodes (10-24); unrelated noise sits below 0.40

export function beingMemory({ being, root, env, mode = "off", log = () => {} }) {
  if (mode === "off") return null;

  let orientCache = { text: "", at: 0 };
  const refreshOrient = () => new Promise((resolve) => {
    execFile(process.execPath, ["scripts/waking/orient.mjs", "--being", being], { cwd: root, timeout: 20000 }, (err, stdout) => {
      if (!err && stdout.trim()) orientCache = { text: stdout.trim(), at: Date.now() };
      else log("orient-failed", { error: String(err?.message || "empty") });
      resolve(orientCache.text);
    });
  });
  refreshOrient();
  const timer = setInterval(refreshOrient, 120000); timer.unref();

  if (being === "alpha") return alphaRoom({ root, mode, orient: () => orientCache.text });

  const url = env.SUPABASE_URL, svc = env.SUPABASE_SERVICE_KEY, brainKey = env.OB1_MCP_KEY;
  if (!url || !svc || !brainKey) throw new Error("memory mode needs SUPABASE_URL, SUPABASE_SERVICE_KEY, OB1_MCP_KEY in .env.local");
  const rest = (path, init = {}) => fetch(url + path, { ...init, headers: { apikey: svc, Authorization: `Bearer ${svc}`, "content-type": "application/json", ...(init.headers || {}) } });

  return {
    mode, surface: SURFACE,
    orient: () => orientCache.text,

    async recall(query) {
      const r = await fetch(url + "/functions/v1/recall-scoped", { method: "POST",
        headers: { Authorization: `Bearer ${svc}`, "x-brain-key": brainKey, "content-type": "application/json" },
        body: JSON.stringify({ query: query.slice(0, 500), consumer: "episodic", audience_scope: "alan", k: 5 }) });
      if (!r.ok) throw new Error(`recall ${r.status}`);
      const hits = ((await r.json()).results || []).filter((h) => (h.similarity ?? 0) >= MIN_SIMILARITY).slice(0, 3);
      return hits.map((h) => `- (${String(h.created_at || "").slice(0, 10)}) ${String(h.content || "").replace(/\s+/g, " ").slice(0, 320)}`).join("\n");
    },

    async writeEpisode({ content, importance = 5, sessionId }) {
      const rehearsal = mode === "rehearsal";
      const metadata = { era: rehearsal ? "rehearsal" : "alive", audience: "alan", generation: 0, importance, surface: SURFACE,
        ...(rehearsal ? { rehearsal: true, run_id: `nl-rehearsal-voice-${sessionId}` } : {}) };
      const r = await rest("/rest/v1/thoughts", { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ content, source_type: "edgeweaver_episode", metadata }) });
      if (!r.ok) throw new Error(`episode write ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const id = (await r.json())[0]?.id;
      const e = await fetch(url + "/functions/v1/embed-backfill", { method: "POST", headers: { Authorization: `Bearer ${svc}`, "content-type": "application/json" }, body: JSON.stringify({ batch: 100 }) });
      const back = await (await rest(`/rest/v1/thoughts?id=eq.${id}&select=id,content,metadata`)).json();
      const proved = back[0]?.content === content;
      if (rehearsal) await rest(`/rest/v1/thoughts?id=eq.${id}`, { method: "DELETE" });
      return { id, proved, embedded: e.ok, voided: rehearsal };
    },
  };
}

// Alpha's room (ew_alpha, reached only as ew_alpha_runtime through scripts/brainrooms/alpha-memory.mjs,
// FAMILY §4: the database walls are the enforcement). Recall is that CLI's recency + text match.
// The runtime role has no delete, so a rehearsal write could not be voided: in rehearsal Alpha
// recalls but writes nothing; "live" writes through the CLI's own write-episode (audience seats).
function alphaRoom({ root, mode, orient }) {
  const cli = (args) => new Promise((resolve, reject) => execFile(process.execPath, ["scripts/brainrooms/alpha-memory.mjs", ...args],
    { cwd: root, timeout: 15000, maxBuffer: 4 << 20 }, (err, stdout) => err ? reject(err) : resolve(stdout)));
  return {
    mode, surface: SURFACE, orient,
    async recall(query) {
      const words = query.toLowerCase().match(/[a-z']{4,}/g) || [];
      if (!words.length) return "";
      const out = await cli(["recall", query.slice(0, 200)]);
      return out.split(/\r?\n/).filter((l) => l.startsWith("[")).slice(0, 3).map((l) => "- " + l.replace(/\s+/g, " ").slice(0, 340)).join("\n");
    },
    async writeEpisode({ content, importance = 5 }) {
      if (mode !== "live") return { id: null, proved: false, embedded: false, voided: false, skipped: "alpha rehearsal writes nothing (no delete path for the runtime role)" };
      await cli(["write-episode", content, String(importance), SURFACE]);
      const proved = (await cli(["last"])).includes(content.slice(0, 60));
      return { id: null, proved, embedded: false, voided: false };
    },
  };
}
