// GET /api/lessons
// Alpha's lessons from ew_alpha.agent_memories joined to the ew_lesson_weights sidecar
// (D47: load class, weight, and the owed ledger): open commitments first, then confirmed
// rules by weight, then pending candidates. Read-only display; confirmation itself stays with the
// seats' existing flow (a seat's confirmation is the only path to
// instruction-grade), never this dashboard.
import { withRoom, json, fail } from "./_lib/db.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  try {
    const items = await withRoom(async (c) =>
      (await c.query(
        `SELECT m.id, m.summary, m.content, m.confidence, m.can_use_as_instruction, m.created_at,
                coalesce(w.load_class, 'rule') AS load_class, round(w.weight::numeric, 2) AS weight,
                w.class_set_by, w.due_at, w.owed_to, w.discharged_at,
                w.pinned_by, w.pin_reason, w.pin_proposed
           FROM ew_alpha.agent_memories m
           LEFT JOIN ew_alpha.ew_lesson_weights w ON w.memory_id = m.id
          WHERE m.lifecycle_status = 'active' AND m.memory_type = 'lesson'
          ORDER BY (w.load_class = 'commitment' AND w.discharged_at IS NULL) DESC,
                   (w.pinned_by IS NOT NULL) DESC,
                   m.can_use_as_instruction DESC, w.weight DESC NULLS LAST, m.created_at DESC
          LIMIT 200`
      )).rows
    );
    return json(res, 200, { items });
  } catch (err) {
    return fail(res, err);
  }
}
