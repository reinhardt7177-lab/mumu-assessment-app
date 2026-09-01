ALTER TABLE student_attempts
  ADD COLUMN IF NOT EXISTS curriculum_student_id uuid REFERENCES curriculum_students(id) ON DELETE RESTRICT;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS attempts_curriculum_student ON student_attempts (curriculum_student_id, submitted_at DESC) WHERE curriculum_student_id IS NOT NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS attempts_assessment_curriculum_student
  ON student_attempts (assessment_id, curriculum_student_id) WHERE curriculum_student_id IS NOT NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assessment_events_assessment_unique
  ON assessment_events (assessment_id) WHERE assessment_id IS NOT NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS learning_evidence_attempt_unique
  ON learning_evidence (attempt_id) WHERE attempt_id IS NOT NULL;
-- statement-breakpoint
ALTER TABLE learning_evidence DROP CONSTRAINT IF EXISTS learning_evidence_original_text_check;
-- statement-breakpoint
ALTER TABLE learning_evidence ADD CONSTRAINT learning_evidence_original_text_check
  CHECK (original_text IS NULL OR char_length(original_text) <= 500000);
-- statement-breakpoint
ALTER TABLE learning_evidence DROP CONSTRAINT IF EXISTS learning_evidence_transformed_text_check;
-- statement-breakpoint
ALTER TABLE learning_evidence ADD CONSTRAINT learning_evidence_transformed_text_check
  CHECK (transformed_text IS NULL OR char_length(transformed_text) <= 500000);
