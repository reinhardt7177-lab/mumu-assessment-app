CREATE TABLE IF NOT EXISTS ai_generation_runs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  evidence_id uuid NOT NULL REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  rubric_criterion_id uuid NOT NULL REFERENCES rubric_criteria(id) ON DELETE RESTRICT,
  feature text NOT NULL CHECK (feature IN ('criterion_suggestion')),
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
CREATE INDEX IF NOT EXISTS ai_generation_runs_owner_time ON ai_generation_runs (owner_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_generation_runs_evidence_criterion ON ai_generation_runs (evidence_id, rubric_criterion_id, created_at DESC);
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions
  ADD COLUMN IF NOT EXISTS generation_run_id uuid REFERENCES ai_generation_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS uncertainty text,
  ADD COLUMN IF NOT EXISTS missing_evidence text,
  ADD COLUMN IF NOT EXISTS construct_caution text;
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ai_criterion_suggestions_generation_run ON ai_criterion_suggestions (generation_run_id) WHERE generation_run_id IS NOT NULL;
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions DROP CONSTRAINT IF EXISTS ai_criterion_suggestions_uncertainty_check;
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions ADD CONSTRAINT ai_criterion_suggestions_uncertainty_check CHECK (uncertainty IS NULL OR char_length(uncertainty) BETWEEN 1 AND 3000);
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions DROP CONSTRAINT IF EXISTS ai_criterion_suggestions_missing_evidence_check;
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions ADD CONSTRAINT ai_criterion_suggestions_missing_evidence_check CHECK (missing_evidence IS NULL OR char_length(missing_evidence) BETWEEN 1 AND 3000);
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions DROP CONSTRAINT IF EXISTS ai_criterion_suggestions_construct_caution_check;
-- statement-breakpoint
ALTER TABLE ai_criterion_suggestions ADD CONSTRAINT ai_criterion_suggestions_construct_caution_check CHECK (construct_caution IS NULL OR char_length(construct_caution) BETWEEN 1 AND 3000);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_question_generation_runs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  title text NOT NULL CHECK (char_length(title) <= 120),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 2 AND 30),
  learning_goal text NOT NULL CHECK (char_length(learning_goal) BETWEEN 5 AND 500),
  standards jsonb NOT NULL,
  requested_count smallint NOT NULL CHECK (requested_count BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'error')),
  output jsonb,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 80),
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'pending' AND completed_at IS NULL AND output IS NULL) OR (status = 'complete' AND completed_at IS NOT NULL AND output IS NOT NULL) OR (status = 'error' AND completed_at IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_question_generation_owner_time ON ai_question_generation_runs (owner_id, created_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_question_generation_dedupe ON ai_question_generation_runs (owner_id, model, prompt_version, input_hash, created_at DESC);
