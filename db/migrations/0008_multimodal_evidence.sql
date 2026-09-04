CREATE TABLE IF NOT EXISTS teacher_evidence_policies (
  owner_id text PRIMARY KEY,
  student_evidence_ai_enabled boolean NOT NULL DEFAULT false,
  provider_id text NOT NULL DEFAULT 'disabled' CHECK (provider_id ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  acknowledgement text,
  policy_version text,
  acknowledged_at timestamptz,
  retention_days smallint NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 30 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT student_evidence_ai_enabled OR (
    provider_id <> 'disabled'
    AND char_length(coalesce(acknowledgement, '')) BETWEEN 10 AND 1000
    AND char_length(coalesce(policy_version, '')) BETWEEN 1 AND 80
    AND acknowledged_at IS NOT NULL
  ))
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS attempt_response_evidence (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES student_attempts(id) ON DELETE RESTRICT,
  question_id text NOT NULL CHECK (char_length(question_id) BETWEEN 1 AND 64),
  modality text NOT NULL CHECK (modality IN ('photo', 'speech', 'chat')),
  assistance_level text NOT NULL DEFAULT 'independent' CHECK (assistance_level IN ('independent', 'teacher_prompt', 'step_hint', 'example', 'scaffolded')),
  state text NOT NULL DEFAULT 'capturing' CHECK (state IN ('capturing', 'ready', 'submitted', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id, modality)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS attempt_response_evidence_attempt
  ON attempt_response_evidence (attempt_id, question_id);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS evidence_assets (
  id uuid PRIMARY KEY,
  response_evidence_id uuid NOT NULL REFERENCES attempt_response_evidence(id) ON DELETE RESTRICT,
  blob_pathname text NOT NULL UNIQUE CHECK (char_length(blob_pathname) BETWEEN 8 AND 1000),
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 240),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 3000000),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  identifiers_removed_confirmed boolean NOT NULL DEFAULT false,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 180),
  retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS evidence_assets_response
  ON evidence_assets (response_evidence_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS evidence_derivations (
  id uuid PRIMARY KEY,
  response_evidence_id uuid NOT NULL REFERENCES attempt_response_evidence(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('ocr', 'transcript', 'teacher_correction')),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'error')),
  extracted_text text CHECK (extracted_text IS NULL OR char_length(extracted_text) BETWEEN 1 AND 50000),
  confidence numeric(4, 3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(segments) = 'array'),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 80),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  supersedes_id uuid REFERENCES evidence_derivations(id) ON DELETE RESTRICT,
  correction_reason text CHECK (correction_reason IS NULL OR char_length(correction_reason) BETWEEN 5 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'pending' AND completed_at IS NULL) OR (status <> 'pending' AND completed_at IS NOT NULL)),
  CHECK ((status = 'complete') = (extracted_text IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS evidence_derivations_response
  ON evidence_derivations (response_evidence_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS assessment_chat_sessions (
  id uuid PRIMARY KEY,
  response_evidence_id uuid NOT NULL UNIQUE REFERENCES attempt_response_evidence(id) ON DELETE RESTRICT,
  allowed_help_level text NOT NULL DEFAULT 'step_hint' CHECK (allowed_help_level IN ('prompt_only', 'step_hint', 'example')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'submitted')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  elapsed_seconds integer NOT NULL DEFAULT 0 CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  CHECK ((state = 'submitted') = (ended_at IS NOT NULL))
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS assessment_chat_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES assessment_chat_sessions(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 100),
  role text NOT NULL CHECK (role IN ('student', 'assistant')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  help_type text NOT NULL DEFAULT 'none' CHECK (help_type IN ('none', 'prompt', 'step_hint', 'example')),
  elapsed_seconds integer NOT NULL DEFAULT 0 CHECK (elapsed_seconds BETWEEN 0 AND 86400),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS assessment_chat_messages_session
  ON assessment_chat_messages (session_id, sequence);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS evidence_ai_runs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  response_evidence_id uuid NOT NULL REFERENCES attempt_response_evidence(id) ON DELETE RESTRICT,
  chat_session_id uuid REFERENCES assessment_chat_sessions(id) ON DELETE RESTRICT,
  feature text NOT NULL CHECK (feature IN ('ocr', 'transcript', 'chat_coach')),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'error')),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 80),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'pending' AND completed_at IS NULL) OR (status <> 'pending' AND completed_at IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS evidence_ai_runs_owner_time
  ON evidence_ai_runs (owner_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS evidence_ai_runs_response
  ON evidence_ai_runs (response_evidence_id, created_at DESC);
-- statement-breakpoint
ALTER TABLE learning_evidence DROP CONSTRAINT IF EXISTS learning_evidence_modality_check;
-- statement-breakpoint
ALTER TABLE learning_evidence ADD CONSTRAINT learning_evidence_modality_check
  CHECK (modality IN ('text', 'photo', 'speech', 'observation', 'chat', 'multimodal'));
-- statement-breakpoint
ALTER TABLE learning_evidence DROP CONSTRAINT IF EXISTS learning_evidence_source_kind_check;
-- statement-breakpoint
ALTER TABLE learning_evidence ADD CONSTRAINT learning_evidence_source_kind_check
  CHECK (source_kind IN ('student_response', 'handwritten_work', 'recording', 'teacher_observation', 'chatbot_transcript', 'mixed_response'));
-- statement-breakpoint
ALTER TABLE learning_evidence DROP CONSTRAINT IF EXISTS learning_evidence_original_text_check;
-- statement-breakpoint
ALTER TABLE learning_evidence ADD CONSTRAINT learning_evidence_original_text_check
  CHECK (original_text IS NULL OR char_length(original_text) <= 250000);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS semester_reports (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES curriculum_terms(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES curriculum_students(id) ON DELETE RESTRICT,
  report_data jsonb NOT NULL CHECK (jsonb_typeof(report_data) = 'object'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'final')),
  revision integer NOT NULL CHECK (revision > 0),
  teacher_id text NOT NULL,
  supersedes_id uuid REFERENCES semester_reports(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, student_id, revision)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS semester_reports_lookup
  ON semester_reports (term_id, student_id, revision DESC);
-- statement-breakpoint
CREATE TRIGGER evidence_assets_immutable
  BEFORE UPDATE OR DELETE ON evidence_assets
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER assessment_chat_messages_immutable
  BEFORE UPDATE OR DELETE ON assessment_chat_messages
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER semester_reports_immutable
  BEFORE UPDATE OR DELETE ON semester_reports
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
