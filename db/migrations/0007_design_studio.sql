CREATE TABLE IF NOT EXISTS design_sessions (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 6),
  subject text NOT NULL CHECK (subject IN ('국어', '사회', '수학', '과학', '도덕', '영어')),
  learning_goal text NOT NULL CHECK (char_length(learning_goal) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved')),
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 7),
  validity_checked_at timestamptz,
  approved_assessment_id uuid REFERENCES assessments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS design_sessions_owner_time ON design_sessions (owner_id, updated_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS design_sources (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES design_sessions(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('direct_text', 'upload')),
  file_name text,
  mime_type text,
  sha256 char(64),
  extracted_text text NOT NULL CHECK (char_length(extracted_text) BETWEEN 5 AND 50000),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS design_sources_session_time ON design_sources (session_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS standard_alignment_candidates (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES design_sessions(id) ON DELETE CASCADE,
  standard_code text NOT NULL CHECK (char_length(standard_code) BETWEEN 4 AND 30),
  domain text NOT NULL CHECK (char_length(domain) BETWEEN 1 AND 200),
  standard_content text NOT NULL CHECK (char_length(standard_content) BETWEEN 5 AND 2000),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 5 AND 1000),
  confidence numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  state text NOT NULL CHECK (state IN ('suggested', 'selected', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, standard_code)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS competency_unpacks (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES design_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source IN ('ai', 'teacher', 'basic_draft')),
  output jsonb NOT NULL CHECK (jsonb_typeof(output) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, version)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS assessment_blueprints (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES design_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source IN ('ai', 'teacher', 'basic_draft')),
  rubric jsonb NOT NULL CHECK (jsonb_typeof(rubric) = 'array'),
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  methods jsonb NOT NULL DEFAULT '["text"]'::jsonb CHECK (jsonb_typeof(methods) = 'array'),
  grading jsonb NOT NULL DEFAULT '{"upperThreshold":80,"middleThreshold":50}'::jsonb CHECK (jsonb_typeof(grading) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, version)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS validity_audits (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES design_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source IN ('ai', 'teacher', 'basic_draft')),
  output jsonb NOT NULL CHECK (jsonb_typeof(output) = 'object'),
  blocked boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, version)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS design_generation_runs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES design_sessions(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  feature text NOT NULL CHECK (feature IN ('competency_unpack', 'rubric_generation', 'assessment_generation', 'validity_audit')),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'error')),
  input_json jsonb NOT NULL CHECK (jsonb_typeof(input_json) = 'object'),
  output_json jsonb,
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
CREATE INDEX IF NOT EXISTS design_generation_runs_lookup
  ON design_generation_runs (session_id, feature, created_at DESC);
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS design_generation_runs_completed_cache
  ON design_generation_runs (owner_id, session_id, feature, model, prompt_version, input_hash)
  WHERE status = 'complete';
