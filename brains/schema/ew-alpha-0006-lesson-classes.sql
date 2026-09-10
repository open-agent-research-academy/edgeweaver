-- ew_alpha copy of 0006-lesson-classes.sql (see the migration's NOTE).
-- Differences: search_path ew_alpha, no workspace guard (the room IS the scope),
-- calibration seats guarded by the current seat roster (alan, ali, tamara, natalie,
-- charlotte, marina; roster changes arrive as ops migrations), class_set_by
-- 'edgeweaver-alpha', EXECUTE granted to ew_alpha_runtime. No table grant: the role
-- reaches the sidecar only through these two doors.

ALTER TABLE ew_alpha.ew_lesson_weights
  ADD COLUMN IF NOT EXISTS load_class text NOT NULL DEFAULT 'rule',
  ADD COLUMN IF NOT EXISTS class_set_by text,
  ADD COLUMN IF NOT EXISTS class_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS owed_to text,
  ADD COLUMN IF NOT EXISTS discharged_at timestamptz,
  ADD COLUMN IF NOT EXISTS discharge_note text;

ALTER TABLE ew_alpha.ew_lesson_weights DROP CONSTRAINT IF EXISTS ew_lesson_weights_load_class_check;
ALTER TABLE ew_alpha.ew_lesson_weights ADD CONSTRAINT ew_lesson_weights_load_class_check
  CHECK (load_class ~ '^(rule|heuristic|knowledge|commitment|calibration:[a-z]+|protocol:(channel|hourly|night))$');

CREATE OR REPLACE FUNCTION ew_alpha.ew_reclass_lesson(p_id uuid, p_class text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ew_alpha
AS $fn$
DECLARE v_by text; v_seat text;
BEGIN
  IF p_class !~ '^(rule|heuristic|knowledge|commitment|calibration:[a-z]+|protocol:(channel|hourly|night))$' THEN
    RETURN 'refused: unknown class (rule | heuristic | knowledge | commitment | calibration:<seat> | protocol:channel|hourly|night)';
  END IF;
  IF p_class LIKE 'calibration:%' THEN
    v_seat := split_part(p_class, ':', 2);
    IF v_seat NOT IN ('alan', 'ali', 'tamara', 'natalie', 'charlotte', 'marina') THEN
      RETURN 'refused: calibration seat must be a current seat (alan, ali, tamara, natalie, charlotte, marina)';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agent_memories WHERE id = p_id
                   AND memory_type = 'lesson' AND lifecycle_status = 'active') THEN
    RETURN 'refused: not an active lesson';
  END IF;
  INSERT INTO ew_lesson_weights (memory_id) VALUES (p_id) ON CONFLICT (memory_id) DO NOTHING;
  SELECT class_set_by INTO v_by FROM ew_lesson_weights WHERE memory_id = p_id;
  IF v_by LIKE 'seat:%' OR v_by = 'ops' THEN
    RETURN 'refused: a seat set this class (' || v_by || '); only a seat changes a seat''s word, ask in the room';
  END IF;
  UPDATE ew_lesson_weights SET load_class = p_class, class_set_by = 'edgeweaver-alpha',
    class_set_at = now(),
    last_move_reason = 'reclassed to ' || p_class || ' by the being' || COALESCE(' :: ' || p_note, '')
  WHERE memory_id = p_id;
  RETURN 'reclassed: ' || p_class || ' (your proposal; any seat can overrule it; ops recompiles the wake file)';
END;
$fn$;

REVOKE ALL ON FUNCTION ew_alpha.ew_reclass_lesson(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ew_alpha.ew_reclass_lesson(uuid, text, text) TO ew_alpha_runtime;

CREATE OR REPLACE FUNCTION ew_alpha.ew_discharge_commitment(p_id uuid, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ew_alpha
AS $fn$
DECLARE v_class text; v_done timestamptz;
BEGIN
  SELECT w.load_class, w.discharged_at INTO v_class, v_done
  FROM ew_lesson_weights w JOIN agent_memories m ON m.id = w.memory_id
  WHERE w.memory_id = p_id AND m.lifecycle_status = 'active';
  IF v_class IS NULL THEN
    RETURN 'refused: not an active lesson with a sidecar row';
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

REVOKE ALL ON FUNCTION ew_alpha.ew_discharge_commitment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ew_alpha.ew_discharge_commitment(uuid, text) TO ew_alpha_runtime;

-- Wall repair found while verifying D47 (2026-09-10): the ew_alpha schema carries a
-- default ACL that grants ew_alpha_runtime ALL on every new table, so the 0002 sidecar
-- came up writable by the being's role (D36 intended read-only; the night loop moves
-- weights on the ops credential). Close it: SELECT only, writes through the two doors above.
REVOKE ALL ON ew_alpha.ew_lesson_weights FROM ew_alpha_runtime;
GRANT SELECT ON ew_alpha.ew_lesson_weights TO ew_alpha_runtime;
