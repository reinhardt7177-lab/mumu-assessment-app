CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  share_code text NOT NULL UNIQUE,
  definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  closed_at timestamptz
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS assessments_owner_created ON assessments (owner_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS student_attempts (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  student_label text NOT NULL CHECK (char_length(student_label) BETWEEN 1 AND 40),
  token_hash text NOT NULL UNIQUE,
  answers jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  time_spent_seconds integer NOT NULL DEFAULT 0 CHECK (time_spent_seconds BETWEEN 0 AND 86400),
  created_at timestamptz NOT NULL DEFAULT now(),
  saved_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS attempts_assessment_status ON student_attempts (assessment_id, status, submitted_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS teacher_reviews (
  attempt_id uuid PRIMARY KEY REFERENCES student_attempts(id),
  reviewer_id text NOT NULL,
  result jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('draft', 'final', 'published')),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS review_events (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES student_attempts(id),
  reviewer_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS review_events_attempt ON review_events (attempt_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS request_limits (
  key text PRIMARY KEY,
  bucket bigint NOT NULL,
  requests integer NOT NULL CHECK (requests > 0)
);
