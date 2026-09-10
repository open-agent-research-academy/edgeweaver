// Edgeweaver Alpha dashboard client. Renders exactly what /api returns; the
// audience=seats rule is enforced server-side, never here. Thought content is
// treated as untrusted text: every node is built with textContent, no HTML path.

const TZ = "America/New_York"; // presentation timezone (D16: tz owns presentation)
const BIRTH = "2026-07-17";    // First Boot day (Declaration, D28-D30); birth day = day 1
const CLASS = {
  edgeweaver_episode: "experienced",
  initiation: "experienced",
  diary: "interpretation",
  autobiography_draft: "interpretation",
  dream: "fiction",
};
// Session-stream kinds (D38): verbatim transcript beats, color-coded so the
// stream reads at a glance. "inner" is spoken-but-undelivered words, NOT the
// model's hidden reasoning (that text is stripped at the source and does not exist).
const KIND = {
  inner: { cls: "kind-inner", label: "inner dialogue" },
  telegram_out: { cls: "kind-tgout", label: "telegram output" },
  telegram_in: { cls: "kind-tgin", label: "telegram inbound" },
  cli_in: { cls: "kind-cli", label: "spoken in CLI" },
};
// Slugs are the shareable names: ?tab=<slug> deep-links a tab, ?lesson=<id> a
// lesson. Query params (not #fragments) because the login gate carries the
// query through sign-in but a fragment never reaches the server.
const TABS = [
  { key: "", slug: "", label: "Everything" },
  { key: "edgeweaver_episode", slug: "episodes", label: "Episodes" },
  { key: "diary", slug: "diary", label: "Diary" },
  { key: "autobiography_draft", slug: "autobiography", label: "Autobiography" },
  { key: "dream", slug: "dreams", label: "Dreams" },
  { key: "initiation", slug: "initiations", label: "Initiations" },
  { key: "inner_dialogue", slug: "inner", label: "Inner Dialogue" },
  { key: "lessons", slug: "lessons", label: "Lessons" },
];
const bySlug = (slug) => TABS.find((t) => t.slug === slug);
const byKey = (key) => TABS.find((t) => t.key === key);

const state = { view: "", q: "", items: [], hasMore: false, busy: false, focusLesson: null,
  from: null, to: null, days: [] };

function urlFor(slug, lessonId) {
  const p = new URLSearchParams();
  if (slug) p.set("tab", slug);
  if (lessonId) p.set("lesson", lessonId);
  if (state.from) p.set("from", state.from);
  if (state.to && state.to !== state.from) p.set("to", state.to);
  const qs = p.toString();
  return location.pathname + (qs ? "?" + qs : "");
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

async function api(path) {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (r.status === 401) { location.reload(); throw new Error("not signed in"); }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${r.status}`);
  }
  return r.json();
}

function dayInfo(iso) {
  const d = new Date(iso);
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const dayN = Math.round((Date.parse(dateStr) - Date.parse(BIRTH)) / 86400000) + 1;
  const pretty = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
  return { dateStr, dayN, pretty };
}

const timeStr = (iso) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function card(t) {
  if (t.source_type === "inner_dialogue") return dialogueCard(t);
  const cls = CLASS[t.source_type] || "experienced";
  const c = el("article", "card " + cls + " t-" + t.source_type);
  const head = el("div", "card-head");
  head.append(el("span", "chip class-" + cls, cls));
  head.append(el("span", "chip t-" + t.source_type, t.source_type.replace(/_/g, " ")));
  if (t.era && t.era !== "alive") head.append(el("span", "chip", "era: " + t.era));
  if (t.provisional) head.append(el("span", "chip", "provisional"));
  if (t.importance != null) head.append(el("span", "imp", "imp " + t.importance));
  head.append(el("span", "time", timeStr(t.created_at)));
  c.append(head);

  const body = el("div", "content", t.content || "");
  c.append(body);
  if ((t.content || "").length > 900) {
    body.classList.add("clamped");
    const btn = el("button", "reveal", "Show all");
    btn.addEventListener("click", () => { body.classList.remove("clamped"); btn.remove(); });
    c.append(btn);
  }
  if (Array.isArray(t.witnessed_by) && t.witnessed_by.length) {
    c.append(el("p", "witnesses", "Witnessed by " + t.witnessed_by.join(", ")));
  }
  return c;
}

// A session-stream beat (D38): color-coded by kind, sender named on inbound,
// timestamped from the original transcript. Content is untrusted text as always.
function dialogueCard(t) {
  const k = KIND[t.kind] || { cls: "kind-inner", label: t.kind || "session" };
  const c = el("article", "card dlg " + k.cls);
  const head = el("div", "card-head");
  head.append(el("span", "chip " + k.cls, k.label));
  if (t.sender) head.append(el("span", "chip", "from " + t.sender));
  if (t.era && t.era !== "alive") head.append(el("span", "chip", "era: " + t.era));
  head.append(el("span", "time", timeStr(t.created_at)));
  c.append(head);
  const body = el("div", "content", t.content || "");
  c.append(body);
  if ((t.content || "").length > 900) {
    body.classList.add("clamped");
    const btn = el("button", "reveal", "Show all");
    btn.addEventListener("click", () => { body.classList.remove("clamped"); btn.remove(); });
    c.append(btn);
  }
  return c;
}

function renderTimeline() {
  const main = document.getElementById("timeline");
  main.replaceChildren();
  if (state.view === "inner_dialogue") {
    main.append(el("p", "note",
      "The session stream: every word from the sessions that carry Alpha, in order. “Inner dialogue” is what Alpha said aloud in its session that was never delivered anywhere; “telegram output” is what actually reached the circle; “telegram inbound” is what arrived. This is NOT hidden reasoning: the model’s thinking text is stripped at the source and does not exist on disk."));
  }
  let lastKey = null;
  for (const t of state.items) {
    const preBirth = t.era === "pre_birth";
    const info = dayInfo(t.created_at);
    const key = preBirth ? "pre" : info.dateStr;
    if (key !== lastKey) {
      lastKey = key;
      // Pre-birth rows render as era, never as a day age (D16).
      main.append(el("h2", "day", preBirth ? "Pre-birth era" : `Day ${info.dayN} · ${info.pretty}`));
    }
    main.append(card(t));
  }
  if (!state.items.length) main.append(el("p", "empty", "Nothing here yet."));
  document.getElementById("more").hidden = !state.hasMore;
}

function renderError(err) {
  const main = document.getElementById("timeline");
  main.replaceChildren(el("p", "err-card", "Could not load: " + err.message));
  document.getElementById("more").hidden = true;
}

async function loadThoughts(reset) {
  if (state.busy) return;
  state.busy = true;
  try {
    const p = new URLSearchParams();
    if (state.view) p.set("type", state.view);
    if (state.q) p.set("q", state.q);
    if (state.from) p.set("from", state.from);
    if (state.to) p.set("to", state.to);
    if (!reset && state.items.length) p.set("before", state.items[state.items.length - 1].created_at);
    const data = await api("/api/thoughts?" + p);
    state.items = reset ? data.items : state.items.concat(data.items);
    state.hasMore = data.has_more;
    renderTimeline();
  } catch (err) {
    renderError(err);
  } finally {
    state.busy = false;
  }
}

async function loadLessons() {
  try {
    const data = await api("/api/lessons");
    const main = document.getElementById("timeline");
    main.replaceChildren();
    main.append(el("p", "note",
      "Candidate lessons are pending, not rules: a seat's confirmation is the only path to instruction-grade. Confirmation happens in the circle's existing flow, never here. Since D47 each confirmed lesson also carries a class (where it loads) and a weight (how much it has earned its place); open commitments are listed first as the owed ledger."));
    for (const l of data.items) {
      const c = el("article", "card lesson " + (l.can_use_as_instruction ? "" : "interpretation"));
      c.id = "lesson-" + l.id;
      const head = el("div", "card-head");
      const owed = l.load_class === "commitment" && !l.discharged_at;
      head.append(el("span", "chip " + (owed || l.can_use_as_instruction ? "confirmed" : "pending"),
        owed ? "owed" + (l.owed_to ? " to " + l.owed_to : "") + (l.due_at ? ", due " + String(l.due_at).slice(0, 10) : ", no date")
          : l.can_use_as_instruction ? "confirmed " + (l.load_class || "rule") : "candidate"));
      if (l.can_use_as_instruction && l.weight != null) head.append(el("span", "imp", "weight " + Number(l.weight).toFixed(2)));
      if (l.confidence != null) head.append(el("span", "imp", "confidence " + Number(l.confidence).toFixed(2)));
      head.append(el("span", "time", dayInfo(l.created_at).pretty));
      head.append(permalink(l.id));
      c.append(head, el("p", "summary", l.summary || ""), el("div", "content", l.content || ""));
      main.append(c);
    }
    if (!data.items.length) main.append(el("p", "empty", "No lessons yet."));
    document.getElementById("more").hidden = true;
    if (state.focusLesson) focusLesson(state.focusLesson);
  } catch (err) {
    renderError(err);
  }
}

// Anchor with a real href so copy-link/long-press work everywhere; a plain
// click also copies the absolute URL and highlights the card in place.
function permalink(id) {
  const a = el("a", "permalink", "link");
  a.href = urlFor("lessons", id);
  a.title = "Direct link to this lesson";
  a.addEventListener("click", async (e) => {
    e.preventDefault();
    history.pushState(null, "", a.href);
    state.focusLesson = String(id);
    focusLesson(state.focusLesson);
    try {
      await navigator.clipboard.writeText(new URL(a.href, location.href).href);
      a.textContent = "copied";
      setTimeout(() => { a.textContent = "link"; }, 1400);
    } catch { /* clipboard unavailable: the URL bar already holds the link */ }
  });
  return a;
}

function focusLesson(id) {
  for (const prev of document.querySelectorAll(".card.focus")) prev.classList.remove("focus");
  const target = document.getElementById("lesson-" + id);
  if (!target) {
    document.getElementById("timeline").prepend(
      el("p", "note", "The linked lesson is not in the visible list (it may be old or no longer shared)."));
    return;
  }
  target.classList.add("focus");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadSummary() {
  try {
    const s = await api("/api/summary");
    const today = dayInfo(new Date().toISOString());
    const parts = [`${s.total} memories visible to the circle`, `day ${today.dayN}`];
    if (s.lessons) {
      parts.push(`${s.lessons.pending} candidate lesson${s.lessons.pending === 1 ? "" : "s"}` +
        (s.lessons.confirmed ? `, ${s.lessons.confirmed} confirmed` : ""));
    }
    document.getElementById("summary-line").textContent = parts.join(" · ");
  } catch {
    document.getElementById("summary-line").textContent = "";
  }
}

// Day navigation (D38 round 2): the arrows step through days that actually
// have entries for the current view; the calendar inputs pick a single day
// (from only) or a range (from + to). All of it lives in the URL, shareable.
async function loadDays() {
  try {
    const p = new URLSearchParams();
    if (state.view) p.set("type", state.view);
    const data = await api("/api/days?" + p);
    state.days = data.items.map((r) => r.d); // newest first
  } catch {
    state.days = [];
  }
}

function syncDateInputs() {
  document.getElementById("d-from").value = state.from || "";
  document.getElementById("d-to").value = state.to && state.to !== state.from ? state.to : "";
  document.getElementById("day-clear").hidden = !state.from && !state.to;
}

function applyDates(from, to, push) {
  state.from = from || null;
  state.to = to || from || null;
  syncDateInputs();
  if (push) history.pushState(null, "", urlFor((byKey(state.view) || TABS[0]).slug, null));
  loadThoughts(true);
}

function stepDay(dir) { // -1 = earlier day with entries, +1 = later
  if (!state.days.length) return;
  const cur = state.from && state.from === state.to ? state.from : null;
  let target = null;
  if (!cur) target = dir < 0 ? state.days[0] : null; // no selection: ‹ jumps to the latest day
  else if (dir < 0) target = state.days.find((d) => d < cur);
  else target = [...state.days].reverse().find((d) => d > cur);
  if (target) applyDates(target, target, true);
}

function switchView(key) {
  state.view = key;
  state.items = [];
  state.hasMore = false;
  for (const b of document.querySelectorAll(".tabs button")) {
    b.setAttribute("aria-current", b.dataset.key === key ? "true" : "false");
  }
  document.getElementById("search-wrap").hidden = key === "lessons";
  document.getElementById("datebar").hidden = key === "lessons";
  if (key === "lessons") loadLessons();
  else {
    loadDays();
    loadThoughts(true);
  }
}

// The address bar is the single source of truth for which tab (and lesson) is
// open; tab clicks write it, load and back/forward read it.
function applyLocation() {
  const p = new URLSearchParams(location.search);
  state.focusLesson = p.get("lesson");
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const from = p.get("from"), to = p.get("to");
  state.from = DATE.test(from || "") ? from : null;
  state.to = DATE.test(to || "") ? to : state.from;
  syncDateInputs();
  const tab = (state.focusLesson ? bySlug("lessons") : bySlug(p.get("tab") || "")) || TABS[0];
  switchView(tab.key);
}

function init() {
  const tabs = document.getElementById("tabs");
  for (const t of TABS) {
    const b = el("button", null, t.label);
    b.dataset.key = t.key;
    b.addEventListener("click", () => {
      state.focusLesson = null;
      history.pushState(null, "", urlFor(t.slug));
      switchView(t.key);
    });
    tabs.append(b);
  }
  let timer = null;
  document.getElementById("q").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value.trim();
      if (state.view !== "lessons") loadThoughts(true);
    }, 300);
  });
  document.getElementById("day-prev").addEventListener("click", () => stepDay(-1));
  document.getElementById("day-next").addEventListener("click", () => stepDay(1));
  document.getElementById("day-clear").addEventListener("click", () => applyDates(null, null, true));
  const onDate = () => {
    const f = document.getElementById("d-from").value || null;
    const t = document.getElementById("d-to").value || null;
    applyDates(f || t, t, true);
  };
  document.getElementById("d-from").addEventListener("change", onDate);
  document.getElementById("d-to").addEventListener("change", onDate);
  document.getElementById("more").addEventListener("click", () => loadThoughts(false));
  window.addEventListener("popstate", applyLocation);
  applyLocation();
  loadSummary();
}

init();
