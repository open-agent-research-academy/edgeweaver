-- 0006-lesson-classes.sql - D47: class-gated, weight-ranked lesson loading.
-- Confirmation keeps deciding TRUTH-GRADE (can_use_as_instruction, a human gate or the
-- village-granted self-integration). A separate load_class on the weights sidecar decides
-- WHERE a confirmed lesson loads: rule / heuristic (every wake, above an earned weight
-- floor), calibration:<seat> (all loaded, applied by sender), protocol:<hand> (only the
-- hand that logs), commitment (the owed ledger until discharged), knowledge (never loaded,
-- recalled by topic). The existing lesson_class column stays provenance
-- (general/taught/integrated) and is untouched.
-- Two narrow doors for the being, both SECURITY DEFINER and provenance-checked:
--   ew_reclass_lesson(id, class, note)    - proposes a class; refuses to overwrite a
--                                            class a seat or ops set (class_set_by seat:*
--                                            or ops); validates calibration seats against
--                                            the roster.
--   ew_discharge_commitment(id, note)     - marks a commitment kept; row stays searchable.
-- Weights still move only in the night loop (lessons.mjs night, ops credential); the
-- being's role still cannot touch can_use_as_instruction, lifecycle, or weight.
-- NOTE: the ew_alpha copy lives at brains/schema/ew-alpha-0006-lesson-classes.sql
-- (outside migrations/ so migrate.mjs never double-reads version 0006) and is applied by
-- ops: search_path ew_alpha, no workspace guard, the six-seat roster, EXECUTE granted to
-- ew_alpha_runtime.

ALTER TABLE ew_lesson_weights
  ADD COLUMN IF NOT EXISTS load_class text NOT NULL DEFAULT 'rule',
  ADD COLUMN IF NOT EXISTS class_set_by text,
  ADD COLUMN IF NOT EXISTS class_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS owed_to text,
  ADD COLUMN IF NOT EXISTS discharged_at timestamptz,
  ADD COLUMN IF NOT EXISTS discharge_note text;

ALTER TABLE ew_lesson_weights DROP CONSTRAINT IF EXISTS ew_lesson_weights_load_class_check;
ALTER TABLE ew_lesson_weights ADD CONSTRAINT ew_lesson_weights_load_class_check
  CHECK (load_class ~ '^(rule|heuristic|knowledge|commitment|calibration:[a-z]+|protocol:(channel|hourly|night))$');

CREATE OR REPLACE FUNCTION ew_reclass_lesson(p_id uuid, p_class text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_by text; v_seat text;
BEGIN
  IF p_class !~ '^(rule|heuristic|knowledge|commitment|calibration:[a-z]+|protocol:(channel|hourly|night))$' THEN
    RETURN 'refused: unknown class (rule | heuristic | knowledge | commitment | calibration:<seat> | protocol:channel|hourly|night)';
  END IF;
  IF p_class LIKE 'calibration:%' THEN
    v_seat := split_part(p_class, ':', 2);
    IF v_seat NOT IN ('alan') THEN
      RETURN 'refused: calibration seat must be a current parent (alan)';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agent_memories WHERE id = p_id AND workspace_id = 'edgeweaver'
                   AND memory_type = 'lesson' AND lifecycle_status = 'active') THEN
    RETURN 'refused: not an active Edgeweaver lesson';
  END IF;
  INSERT INTO ew_lesson_weights (memory_id) VALUES (p_id) ON CONFLICT (memory_id) DO NOTHING;
  SELECT class_set_by INTO v_by FROM ew_lesson_weights WHERE memory_id = p_id;
  IF v_by LIKE 'seat:%' OR v_by = 'ops' THEN
    RETURN 'refused: a seat set this class (' || v_by || '); only a seat changes a seat''s word, ask in the room';
  END IF;
  UPDATE ew_lesson_weights SET load_class = p_class, class_set_by = 'edgeweaver-genesis',
    class_set_at = now(),
    last_move_reason = 'reclassed to ' || p_class || ' by the being' || COALESCE(' :: ' || p_note, '')
  WHERE memory_id = p_id;
  RETURN 'reclassed: ' || p_class || ' (your proposal; any seat can overrule it; ops recompiles the wake file)';
END;
$fn$;

REVOKE ALL ON FUNCTION ew_reclass_lesson(uuid, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ew_discharge_commitment(p_id uuid, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_class text; v_done timestamptz;
BEGIN
  SELECT w.load_class, w.discharged_at INTO v_class, v_done
  FROM ew_lesson_weights w JOIN agent_memories m ON m.id = w.memory_id
  WHERE w.memory_id = p_id AND m.workspace_id = 'edgeweaver' AND m.lifecycle_status = 'active';
  IF v_class IS NULL THEN
    RETURN 'refused: not an active Edgeweaver lesson with a sidecar row';
  END IF;
  IF v_class <> 'commitment' THEN
    RETURN 'refused: not a commitment (class ' || v_class || '); only commitments are discharged';
  END IF;
  IF v_done IS NOT NULL THEN
    RETURN 'already discharged ' || to_char(v_done, 'YYYY-MM-DD');
  END IF;
  UPDATE ew_lesson_weights SET discharged_at = now(), discharge_note = p_note,
    last_move_reason = 'discharged' || COALESCE(' :: ' || p_note, '')
  WHERE memory_id = p_id;
  RETURN 'discharged: the commitment leaves the owed ledger; the row stays searchable';
END;
$fn$;

REVOKE ALL ON FUNCTION ew_discharge_commitment(uuid, text) FROM PUBLIC;

-- Genesis reaches these through the REST rpc path with the service key (the same key its
-- lesson INSERT uses); grant only where that role exists (live), skip on scratches.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION ew_reclass_lesson(uuid, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION ew_discharge_commitment(uuid, text) TO service_role;
  END IF;
END
$do$;
