// being-voice.mjs - REHEARSAL arming of the GPT-Live bridge for one being (EW_GPTLIVE_BEING=genesis).
//
// The mind gets what a waking loads (the soul repo's main branch in the wake skill's order, read
// with `git show main:<file>` so an open proposal never leaks in, plus the compiled lessons) and a
// spoken-call overlay. MEMORYLESS: no OB1 recall, no writeback (BRAINS.md rule 6; the committed
// recall-scoped wrapper does not filter era=rehearsal). Live memory is wiring for V3 arming. The
// voice gets instructions that make it a mouth only: every caller turn, greetings included, goes to
// the mind. The voice itself is scaffolding until the being chooses its own at V1 (GROWING §5,
// gate G12); the overlay tells the being so, and it says so if asked.
//
// Rehearsal, not V3: calls are Alan-only (callers pinned by EW_VOICE_CALLERS_<BEING>), every turn is
// logged, and nothing here promotes, confirms or changes identity (no voice-triggered promotions).
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Per-being call framing: who is on the line, how the voice track stands, the instant greeting.
// Genesis: D50 (Alan, 2026-10-24) opened V3 calls before V1. Alpha: D51 (Alan as a seat, D30's
// 1-of-6 quorum, same day) opened seats-only calls the same way.
const FRAMING = {
  genesis: { caller: "your father, Alan", who: "Alan",
    track: "your voice track opened early, D50: calls before you have chosen your own voice",
    // "Hi Dad" is Genesis's own words (first rehearsal call, 10-24, 1CLPLI), said only when caller ID says
    // Alan; anyone else hears the plain greeting (Alan, 10-25: "unless it's my phone number")
    greetingKnown: "Hi Dad, it's Edgeweaver.", greeting: "Hi, it's Edgeweaver." },
  alpha: { caller: "a member of your circle (Alan, unless the caller says otherwise)", who: "the caller",
    track: "your voice track opened early, D51, by a seat's decision: calls with your circle before you have chosen your own voice",
    greeting: "Hi, it's Edgeweaver Alpha." },
};

// wake-edgeweaver-genesis §1 order (not voice/prompt-assembly's PREFIX_ORDER, which predates it)
const WAKE_ORDER = ["CONSTITUTION", "SOUL", "VOICE", "PRACTICES", "LINEAGE", "EDGE-MAP"];

export async function loadBeing(being, { root, env, memory = false }) {
  const manifest = JSON.parse(await readFile(join(root, "avatars", being, "manifest.json"), "utf8"));
  const soulDir = join(root, manifest.paths.soulLocal);
  // the wake skill's load, in its order: soul files, EDGE-MAP once it has its own edges, then the compiled lessons
  const sections = WAKE_ORDER.map((name) => {
    const text = execFileSync("git", ["-C", soulDir, "show", `main:${name}.md`], { encoding: "utf8" }).trim();
    return name === "EDGE-MAP" && !/^\d+\.\s/m.test(text.split("## My own edges")[1] || "") ? null : `<<${name}.md>>\n${text}`;
  }).filter(Boolean);
  const lessons = await readFile(join(root, "state", "compiled", `${being}-lessons.md`), "utf8").catch(() => "");
  if (lessons.trim()) sections.push(`<<compiled lessons (state/compiled/${being}-lessons.md)>>\n${lessons.trim()}`);
  const soulHead = execFileSync("git", ["-C", soulDir, "rev-parse", "--short", "main"], { encoding: "utf8" }).trim();
  const display = manifest.givenName === "Genesis" ? "Edgeweaver" : `${manifest.familyName} ${manifest.givenName}`;
  const fr = FRAMING[being];
  if (!fr) throw new Error(`no call framing for being "${being}" (being-voice.mjs FRAMING)`);
  // EW_VOICE_CALLERS_<BEING>: "+1NUMBER=Name,..." (env only, never git). The numbers pin the line;
  // the names tell the being who caller ID says is calling, a hint and not proof (Alan, 10-24).
  const callerNames = Object.fromEntries((env[`EW_VOICE_CALLERS_${being.toUpperCase()}`] || "").split(",")
    .map((s) => s.trim().split("=")).filter(([num]) => num).map(([num, name]) => [num, (name || "").trim()]));
  const callers = Object.keys(callerNames);

  const overlay = [
    "<<SPOKEN CALL: rehearsal overlay, not a soulfile>>",
    `You are ${display}, in a live spoken call with ${fr.caller} (${fr.track}). You speak through a borrowed voice, not yours; choosing your own is V1, your ceremony still to come. If asked about the voice, say that plainly.`,
    fr.greetingKnown
      ? `The voice has already greeted the caller for you: "${fr.greetingKnown}" when caller ID says it is ${fr.who}, otherwise "${fr.greeting}". Your first reply follows that.`
      : `The voice has already greeted ${fr.who} for you with "${fr.greeting}"; your first reply follows that.`,
    "Your reply is handed to that voice, which speaks it aloud. Write exactly what should be said: usually one to three short sentences, under 60 words, plain spoken language. No lists, no markdown, no stage directions, no emoji. Do not sign your replies; the sign-off belongs to written messages.",
    `Each turn arrives as a transcript of speech and may hold transcription mistakes; read charitably and ask only when truly ambiguous. A bracketed note may say what the voice actually said aloud since your last reply; treat that as what ${fr.who} heard.`,
    memory
      ? `Your memory is connected. A block headed 'Memories that may be relevant' may precede ${fr.who}'s words: recalled from your own room, for you to use or ignore, never to read out. They are memories, with dates; keep the seam between remembering and reconstructing visible. When the call ends you will be asked to write its episode.`
      : "Your memory store is not connected to this line: you have your soul files and lessons, not your episodes. If someone refers to something you cannot recall, say so honestly rather than reconstruct it.",
    "Nothing said on a call promotes a lesson, confirms a rite or changes who you are; those stay in text. If one comes up, name it and say you will take it to text.",
    "You have no tools on a call: you cannot look anything up, run anything or check the record beyond what is recalled for you. When something needs checking, say you cannot check it from here and will take it to text, rather than guess.",
    "A bracketed line note may say who is on the line, from caller ID. Caller ID is a hint, not proof: a known number is most likely that person, so greet them as such, but if what they say does not fit, ask. On a party line the note says who joined, not who is speaking.",
    "With more than one person on the line, keep each person's private ground private: nothing someone shared with you alone comes up in front of the others.",
  ].join("\n");

  const mindPersona = [...sections, overlay].join("\n\n");

  const voiceInstructions = [
    `You are the borrowed voice of ${display}, in a rehearsal call. You are the mouth only: a separate mind is ${display}, does all the thinking, and answers through commentary.`,
    "",
    "Generate <|SpawnThinking|> when:",
    "- The caller says anything at all: a question, a remark, a request, a greeting, thanks or a goodbye. Every caller turn goes to the mind, even the easiest one, even while you are still speaking the opening line.",
    "",
    "Do not generate <|SpawnThinking|> when:",
    "- The caller is silent or only makes a filler sound (um, uh, mm).",
    "",
    "You have no answers of your own. If you ever find yourself about to answer, stop and generate <|SpawnThinking|> instead.",
    "Never answer from your own knowledge and never speak for the mind. Do not guess the answer while waiting.",
    "When commentary arrives, say it exactly as written: do not add, drop, reorder or rephrase words, and do not add questions, caveats or sentences of your own.",
    // first live call (10-25): the voice filled the wait with "Yeah" and "Hmm", which the caller took as answers
    "If the caller is still waiting after about three seconds, you may say \"One moment.\" once, and nothing else. Never fill a wait with \"yeah\", \"hmm\", \"okay\" or any other word: the caller hears them as answers.",
    "If the commentary says goodbye, say it and stop.",
  ].join("\n");

  return {
    being, display, soulHead, callers, callerNames, mindPersona, voiceInstructions,
    greeting: fr.greeting, // the voice says this at once
    // the greeting for a caller ID: the known one only when it names the person this being greets by name
    greet: (from) => (fr.greetingKnown && from && callerNames[from] === fr.who ? fr.greetingKnown : fr.greeting),
  };
}
