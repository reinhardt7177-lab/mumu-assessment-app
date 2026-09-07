-- Additive: retain originals and old derivations. Never guess the source of an ambiguous legacy OCR.
ALTER TABLE student_attempts ADD COLUMN evidence_revision integer NOT NULL DEFAULT 0;
-- statement-breakpoint
ALTER TABLE attempt_response_evidence ADD COLUMN active_asset_id uuid;
-- statement-breakpoint
ALTER TABLE evidence_derivations ADD COLUMN source_asset_id uuid;
-- statement-breakpoint
ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_response_id_unique UNIQUE (response_evidence_id, id);
-- statement-breakpoint
UPDATE attempt_response_evidence r SET active_asset_id = (
  SELECT a.id FROM evidence_assets a WHERE a.response_evidence_id = r.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1
);
-- statement-breakpoint
UPDATE evidence_derivations d SET source_asset_id = a.id
FROM evidence_assets a
WHERE a.response_evidence_id = d.response_evidence_id AND a.created_at <= d.created_at
  AND (SELECT count(*) FROM evidence_assets other WHERE other.response_evidence_id = d.response_evidence_id) = 1;
-- statement-breakpoint
ALTER TABLE attempt_response_evidence ADD CONSTRAINT response_active_asset_fk
  FOREIGN KEY (id, active_asset_id) REFERENCES evidence_assets(response_evidence_id, id) DEFERRABLE INITIALLY DEFERRED;
-- statement-breakpoint
ALTER TABLE evidence_derivations ADD CONSTRAINT derivation_source_asset_fk
  FOREIGN KEY (response_evidence_id, source_asset_id) REFERENCES evidence_assets(response_evidence_id, id);
-- statement-breakpoint
CREATE FUNCTION mumu_guard_derivation_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Derivation history is immutable'; END IF;
  IF OLD.status <> 'pending' OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id
    OR NEW.response_evidence_id <> OLD.response_evidence_id THEN
    RAISE EXCEPTION 'Finished derivation and source binding are immutable';
  END IF;
  RETURN NEW;
END;
$$;
-- statement-breakpoint
CREATE TRIGGER derivation_version_lock BEFORE UPDATE OR DELETE ON evidence_derivations
  FOR EACH ROW EXECUTE FUNCTION mumu_guard_derivation_version();
-- statement-breakpoint
CREATE TABLE evidence_asset_deletions (
  asset_id uuid PRIMARY KEY REFERENCES evidence_assets(id) ON DELETE RESTRICT,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (reason = 'retention_expired')
);
-- statement-breakpoint
CREATE TRIGGER evidence_asset_deletions_immutable BEFORE UPDATE OR DELETE ON evidence_asset_deletions
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE INDEX evidence_assets_retention ON evidence_assets(retention_until, id);
-- statement-breakpoint
CREATE VIEW available_evidence_assets AS
  SELECT a.* FROM evidence_assets a WHERE a.retention_until > now()
    AND NOT EXISTS (SELECT 1 FROM evidence_asset_deletions d WHERE d.asset_id = a.id);
-- statement-breakpoint
CREATE VIEW current_evidence_derivations AS
  SELECT d.* FROM evidence_derivations d
  JOIN attempt_response_evidence r ON r.id = d.response_evidence_id AND r.active_asset_id = d.source_asset_id
  JOIN available_evidence_assets a ON a.id = d.source_asset_id;
-- statement-breakpoint
CREATE FUNCTION mumu_guard_submitted_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'submitted' AND (NEW.state <> 'submitted' OR NEW.active_asset_id IS DISTINCT FROM OLD.active_asset_id) THEN
    RAISE EXCEPTION 'Submitted evidence cannot change its source or reopen';
  END IF;
  RETURN NEW;
END;
$$;
-- statement-breakpoint
CREATE TRIGGER response_submission_lock BEFORE UPDATE ON attempt_response_evidence
  FOR EACH ROW EXECUTE FUNCTION mumu_guard_submitted_response();
-- statement-breakpoint
CREATE FUNCTION mumu_responses_complete(attempt_id uuid, definition jsonb, answers jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(definition->'questions') question
    WHERE NOT (
      char_length(btrim(coalesce(answers->>(question->>'id'), ''))) > 0
      OR EXISTS (
        SELECT 1 FROM attempt_response_evidence r
        WHERE r.attempt_id = $1 AND r.question_id = question->>'id' AND (
          (r.modality IN ('photo', 'speech') AND EXISTS (
            SELECT 1 FROM current_evidence_derivations d WHERE d.response_evidence_id = r.id AND d.status = 'complete'))
          OR (r.modality = 'screen' AND EXISTS (SELECT 1 FROM available_evidence_assets a WHERE a.id = r.active_asset_id))
          OR (r.modality = 'chat' AND EXISTS (
            SELECT 1 FROM assessment_chat_sessions s JOIN assessment_chat_messages m ON m.session_id = s.id
            WHERE s.response_evidence_id = r.id AND m.role = 'student'))
        )
      )
    )
  );
$$;
