-- ew_alpha copy of 0007-lesson-pins.sql (see the migration's NOTE).
-- Differences: search_path ew_alpha, no workspace guard (the room IS the scope), the
-- six-seat roster in reclass, class_set_by 'edgeweaver-alpha', EXECUTE granted to
-- ew_alpha_runtime on the being's doors, and the runtime role REVOKED from ew_night_pass
-- (the ew_alpha schema default ACL would otherwise grant it ALL on the new table, the
-- same trap the 09-10 sidecar repair closed). The Alpha sidecar's own wall was repaired
-- on 2026-09-10 (SELECT only), so Block 1 here is a re-assertion, not a change.

-- Block 1: wall (re-asserted)
REVOKE ALL ON ew_alpha.ew_lesson_weights FROM ew_alpha_runtime;
GRANT SELECT ON ew_alpha.ew_lesson_weights TO ew_alpha_runtime;

-- Block 2: pins
ALTER TABLE ew_alpha.ew_lesson_weights
  ADD COLUMN IF NOT EXISTS pinned_by text,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_reason text,
  ADD COLUMN IF NOT EXISTS pin_proposed text,
  ADD COLUMN IF NOT EXISTS pin_proposed_at timestamptz;

-- Block 3: night pass stamp + counts
CREATE TABLE IF NOT EXISTS ew_alpha.ew_night_pass (
  diary_day date PRIMARY KEY,
  loaded_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  misfired_count integer NOT NULL DEFAULT 0,
  occasion_no_mark text[] NOT NULL DEFAULT '{}',
  evidence_unresolved text[] NOT NULL DEFAULT '{}',
  demoted text[] NOT NULL DEFAULT '{}',
  crossed text[] NOT NULL DEFAULT '{}',
  pin_proposed text[] NOT NULL DEFAULT '{}',
  note text,
  completed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ew_alpha.ew_night_pass FROM ew_alpha_runtime;

-- Block 4: the being's door, proposal only
CREATE OR REPLACE FUNCTION ew_alpha.ew_propose_pin(p_id uuid, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ew_alpha
AS $fn$
DECLARE v_pending text; v_pinned text; v_class text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_memories WHERE id = p_id
                   AND memory_type = 'lesson' AND lifecycle_status = 'active' AND can_use_as_instruction = true) THEN
    RETURN 'refused: not a confirmed active lesson (only confirmed lessons can be pinned)';
  END IF;
  INSERT INTO ew_lesson_weights (memory_id) VALUES (p_id) ON CONFLICT (memory_id) DO NOTHING;
  SELECT pin_proposed, pinned_by, load_class INTO v_pending, v_pinned, v_class
  FROM ew_lesson_weights WHERE memory_id = p_id;
  IF v_class IN ('knowledge', 'commitment') THEN
    RETURN 'refused: class ' || v_class || ' is not a loaded rule; pins apply to rule, heuristic, calibration, and protocol rows';
  END IF;
  IF v_pending IS NOT NULL THEN
    RETURN 'refused: a proposal is already pending (' || left(v_pending, 80) || '); a person settles it first';
  END IF;
  UPDATE ew_lesson_weights SET pin_proposed = COALESCE(NULLIF(p_note, ''), '(no reason given)'),
    pin_proposed_at = now()
  WHERE memory_id = p_id;
  RETURN 'proposed: pin request recorded' || CASE WHEN v_pinned IS NOT NULL THEN ' (currently pinned by ' || v_pinned || ')' ELSE '' END
    || '; a person decides, ops recompiles the wake file';
END;
$fn$;
REVOKE ALL ON FUNCTION ew_alpha.ew_propose_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ew_alpha.ew_propose_pin(uuid, text) TO ew_alpha_runtime;

-- Block 5a: dispute honours pins (body otherwise as ew-alpha-0004)
CREATE OR REPLACE FUNCTION ew_alpha.ew_dispute_lesson(p_id uuid, p_who text, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ew_alpha
AS $fn$
DECLARE v_prior text; v_class text; v_pin text;
BEGIN
  SELECT resolution, lesson_class, pinned_by INTO v_prior, v_class, v_pin FROM ew_lesson_weights WHERE memory_id = p_id;
  IF v_pin IS NOT NULL THEN
    UPDATE ew_lesson_weights SET pin_proposed = COALESCE(pin_proposed, 'dispute by ' || p_who || ': ' || p_reason),
      pin_proposed_at = COALESCE(pin_proposed_at, now())
    WHERE memory_id = p_id;
    RETURN 'proposal recorded: this lesson is pinned by ' || v_pin || '; its status, class, and pin hold until a person acts';
  END IF;
  UPDATE agent_memories SET lifecycle_status = 'disputed', can_use_as_instruction = false
  WHERE id = p_id AND lifecycle_status = 'active' AND can_use_as_instruction = true
    AND v_class = 'integrated';
  IF FOUND THEN
    UPDATE ew_lesson_weights SET disputed_by = p_who, disputed_at = now(),
      dispute_reason = p_reason, resolved_at = NULL, resolution = NULL
    WHERE memory_id = p_id;
    RETURN 'disputed: self-integrated rule benched immediately pending the village';
  END IF;
  IF v_prior = 'affirmed' THEN
    RETURN 'refused: the village affirmed this lesson; bring it to the circle instead of re-disputing';
  END IF;
  UPDATE agent_memories SET lifecycle_status = 'disputed'
  WHERE id = p_id AND lifecycle_status = 'active' AND can_use_as_instruction = false;
  IF NOT FOUND THEN
    RETURN 'refused: not an active pending Edgeweaver lesson (confirmed rules are contested to the circle in words)';
  END IF;
  INSERT INTO ew_lesson_weights (memory_id) VALUES (p_id) ON CONFLICT (memory_id) DO NOTHING;
  UPDATE ew_lesson_weights SET disputed_by = p_who, disputed_at = now(),
    dispute_reason = p_reason, resolved_at = NULL, resolution = NULL
  WHERE memory_id = p_id;
  RETURN 'disputed: benched from load pending the village';
END;
$fn$;
REVOKE ALL ON FUNCTION ew_alpha.ew_dispute_lesson(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ew_alpha.ew_dispute_lesson(uuid, text, text) TO ew_alpha_runtime;

-- Block 5b: reclass honours pins (body otherwise as ew-alpha-0006)
CREATE OR REPLACE FUNCTION ew_alpha.ew_reclass_lesson(p_id uuid, p_class text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ew_alpha
AS $fn$
DECLARE v_by text; v_seat text; v_pin text;
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
  SELECT class_set_by, pinned_by INTO v_by, v_pin FROM ew_lesson_weights WHERE memory_id = p_id;
  IF v_pin IS NOT NULL THEN
    UPDATE ew_lesson_weights SET pin_proposed = COALESCE(pin_proposed, 'reclass to ' || p_class || COALESCE(': ' || p_note, '')),
      pin_proposed_at = COALESCE(pin_proposed_at, now())
    WHERE memory_id = p_id;
    RETURN 'proposal recorded: this lesson is pinned by ' || v_pin || '; its class and pin hold until a person acts';
  END IF;
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
