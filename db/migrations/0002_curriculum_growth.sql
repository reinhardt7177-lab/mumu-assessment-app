CREATE TABLE IF NOT EXISTS curriculum_terms (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  school_year integer NOT NULL CHECK (school_year BETWEEN 2022 AND 2100),
  semester smallint NOT NULL CHECK (semester IN (1, 2)),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 6),
  class_name text NOT NULL CHECK (char_length(class_name) BETWEEN 1 AND 50),
  subject text NOT NULL CHECK (subject IN ('국어', '사회', '수학', '과학', '도덕', '영어')),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, school_year, semester, grade, class_name, subject)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS curriculum_terms_owner_year
  ON curriculum_terms (owner_id, school_year DESC, semester DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS curriculum_units (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES curriculum_terms(id) ON DELETE RESTRICT,
  order_index smallint NOT NULL CHECK (order_index BETWEEN 1 AND 99),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'teaching', 'assessing', 'feedback', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, order_index),
  UNIQUE (term_id, title)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS unit_standards (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES curriculum_units(id) ON DELETE RESTRICT,
  standard_code text NOT NULL CHECK (char_length(standard_code) BETWEEN 4 AND 30),
  standard_content text NOT NULL CHECK (char_length(standard_content) BETWEEN 5 AND 2000),
  domain text NOT NULL CHECK (char_length(domain) BETWEEN 1 AND 200),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, standard_code),
  UNIQUE (unit_id, position)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS unit_standards_code ON unit_standards (standard_code);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS standard_targets (
  id uuid PRIMARY KEY,
  unit_standard_id uuid NOT NULL UNIQUE REFERENCES unit_standards(id) ON DELETE RESTRICT,
  observable_indicators jsonb NOT NULL DEFAULT '[]',
  prerequisites jsonb NOT NULL DEFAULT '[]',
  misconceptions jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(observable_indicators) = 'array'),
  CHECK (jsonb_typeof(prerequisites) = 'array'),
  CHECK (jsonb_typeof(misconceptions) = 'array')
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS rubric_versions (
  id uuid PRIMARY KEY,
  unit_standard_id uuid NOT NULL REFERENCES unit_standards(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'locked', 'retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  CHECK ((state = 'locked') = (locked_at IS NOT NULL) OR state = 'retired'),
  UNIQUE (unit_standard_id, version)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS rubric_criteria (
  id uuid PRIMARY KEY,
  rubric_version_id uuid NOT NULL REFERENCES rubric_versions(id) ON DELETE RESTRICT,
  criterion_key text NOT NULL CHECK (criterion_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(description) BETWEEN 5 AND 1000),
  high_descriptor text NOT NULL CHECK (char_length(high_descriptor) BETWEEN 5 AND 1000),
  middle_descriptor text NOT NULL CHECK (char_length(middle_descriptor) BETWEEN 5 AND 1000),
  low_descriptor text NOT NULL CHECK (char_length(low_descriptor) BETWEEN 5 AND 1000),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  UNIQUE (rubric_version_id, criterion_key),
  UNIQUE (rubric_version_id, name),
  UNIQUE (rubric_version_id, position)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS curriculum_students (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES curriculum_terms(id) ON DELETE RESTRICT,
  student_ref text NOT NULL CHECK (char_length(student_ref) BETWEEN 1 AND 80),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, student_ref)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS curriculum_students_term ON curriculum_students (term_id, active, display_name);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS assessment_events (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES curriculum_units(id) ON DELETE RESTRICT,
  assessment_id uuid REFERENCES assessments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('initial', 'formative', 'reassessment', 'observation', 'conversation')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
  context text NOT NULL CHECK (char_length(context) BETWEEN 5 AND 3000),
  occurred_at timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS assessment_events_unit_time ON assessment_events (unit_id, occurred_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS learning_evidence (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES curriculum_students(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES assessment_events(id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES student_attempts(id) ON DELETE RESTRICT,
  modality text NOT NULL CHECK (modality IN ('text', 'photo', 'speech', 'observation', 'chat')),
  source_kind text NOT NULL CHECK (source_kind IN ('student_response', 'handwritten_work', 'recording', 'teacher_observation', 'chatbot_transcript')),
  assistance_level text NOT NULL CHECK (assistance_level IN ('independent', 'teacher_prompt', 'step_hint', 'example', 'scaffolded')),
  original_text text,
  source_ref text,
  transformed_text text,
  transformation_status text NOT NULL DEFAULT 'original' CHECK (transformation_status IN ('original', 'automated', 'teacher_verified')),
  teacher_verified boolean NOT NULL DEFAULT false,
  collected_at timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_id uuid REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  CHECK (coalesce(char_length(original_text), 0) > 0 OR coalesce(char_length(source_ref), 0) > 0),
  CHECK (original_text IS NULL OR char_length(original_text) <= 50000),
  CHECK (transformed_text IS NULL OR char_length(transformed_text) <= 50000),
  CHECK (source_ref IS NULL OR char_length(source_ref) <= 1000),
  CHECK (NOT teacher_verified OR transformation_status = 'teacher_verified')
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_evidence_student_time ON learning_evidence (student_id, collected_at DESC);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_evidence_event ON learning_evidence (event_id);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_criterion_suggestions (
  id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  rubric_criterion_id uuid NOT NULL REFERENCES rubric_criteria(id) ON DELETE RESTRICT,
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  suggested_level text NOT NULL CHECK (suggested_level IN ('상', '중', '하', '판단 보류')),
  confidence numeric(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  evidence_excerpt text NOT NULL CHECK (char_length(evidence_excerpt) BETWEEN 1 AND 3000),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 5 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS criterion_judgements (
  id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  rubric_criterion_id uuid NOT NULL REFERENCES rubric_criteria(id) ON DELETE RESTRICT,
  teacher_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('상', '중', '하', '판단 보류')),
  evidence_excerpt text NOT NULL CHECK (char_length(evidence_excerpt) BETWEEN 1 AND 3000),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 5 AND 5000),
  state text NOT NULL CHECK (state IN ('draft', 'final')),
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id uuid REFERENCES criterion_judgements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS criterion_judgements_evidence ON criterion_judgements (evidence_id, rubric_criterion_id, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_cycles (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES curriculum_students(id) ON DELETE RESTRICT,
  unit_standard_id uuid NOT NULL REFERENCES unit_standards(id) ON DELETE RESTRICT,
  strength text NOT NULL CHECK (char_length(strength) BETWEEN 5 AND 3000),
  gap_type text NOT NULL CHECK (gap_type IN ('conceptual', 'procedural', 'communication')),
  gap_description text NOT NULL CHECK (char_length(gap_description) BETWEEN 5 AND 3000),
  next_learning text NOT NULL CHECK (char_length(next_learning) BETWEEN 5 AND 3000),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'ready_for_reassessment', 'completed')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_basis (
  cycle_id uuid NOT NULL REFERENCES feedback_cycles(id) ON DELETE RESTRICT,
  judgement_id uuid NOT NULL REFERENCES criterion_judgements(id) ON DELETE RESTRICT,
  PRIMARY KEY (cycle_id, judgement_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS learning_interventions (
  id uuid PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES feedback_cycles(id) ON DELETE RESTRICT,
  activity text NOT NULL CHECK (char_length(activity) BETWEEN 5 AND 3000),
  support_level text NOT NULL CHECK (support_level IN ('teacher_prompt', 'step_hint', 'example', 'scaffolded')),
  teacher_note text NOT NULL CHECK (char_length(teacher_note) BETWEEN 1 AND 3000),
  occurred_at timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS reassessment_links (
  id uuid PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES feedback_cycles(id) ON DELETE RESTRICT,
  prior_evidence_id uuid NOT NULL REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  new_evidence_id uuid NOT NULL REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  independent boolean NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (prior_evidence_id <> new_evidence_id),
  UNIQUE (cycle_id, new_evidence_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS semester_judgements (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES curriculum_terms(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES curriculum_students(id) ON DELETE RESTRICT,
  standard_code text NOT NULL CHECK (char_length(standard_code) BETWEEN 4 AND 30),
  level text NOT NULL CHECK (level IN ('상', '중', '하', '판단 보류')),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 5 AND 5000),
  state text NOT NULL CHECK (state IN ('draft', 'final', 'published')),
  revision integer NOT NULL CHECK (revision > 0),
  teacher_id text NOT NULL,
  supersedes_id uuid REFERENCES semester_judgements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((state = 'published') = (published_at IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS semester_judgements_lookup
  ON semester_judgements (term_id, student_id, standard_code, created_at DESC);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS semester_judgement_evidence (
  judgement_id uuid NOT NULL REFERENCES semester_judgements(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  evidence_role text NOT NULL DEFAULT 'supporting' CHECK (evidence_role IN ('supporting', 'conflicting')),
  PRIMARY KEY (judgement_id, evidence_id)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS semester_summaries (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES curriculum_terms(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES curriculum_students(id) ON DELETE RESTRICT,
  narrative text NOT NULL CHECK (char_length(narrative) BETWEEN 20 AND 8000),
  strengths text NOT NULL CHECK (char_length(strengths) BETWEEN 5 AND 4000),
  next_support text NOT NULL CHECK (char_length(next_support) BETWEEN 5 AND 4000),
  state text NOT NULL CHECK (state IN ('draft', 'final', 'published')),
  revision integer NOT NULL CHECK (revision > 0),
  teacher_id text NOT NULL,
  supersedes_id uuid REFERENCES semester_summaries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((state = 'published') = (published_at IS NOT NULL))
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS curriculum_audit_events (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 80),
  entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 3 AND 80),
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS curriculum_audit_owner_time
  ON curriculum_audit_events (owner_id, created_at DESC);
-- statement-breakpoint
CREATE OR REPLACE FUNCTION mumu_reject_immutable_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable assessment record: append a superseding version instead'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
CREATE TRIGGER learning_evidence_immutable
  BEFORE UPDATE OR DELETE ON learning_evidence
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER ai_criterion_suggestions_immutable
  BEFORE UPDATE OR DELETE ON ai_criterion_suggestions
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER criterion_judgements_immutable
  BEFORE UPDATE OR DELETE ON criterion_judgements
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER learning_interventions_immutable
  BEFORE UPDATE OR DELETE ON learning_interventions
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER reassessment_links_immutable
  BEFORE UPDATE OR DELETE ON reassessment_links
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER semester_judgements_immutable
  BEFORE UPDATE OR DELETE ON semester_judgements
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER semester_summaries_immutable
  BEFORE UPDATE OR DELETE ON semester_summaries
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
-- statement-breakpoint
CREATE TRIGGER curriculum_audit_events_immutable
  BEFORE UPDATE OR DELETE ON curriculum_audit_events
  FOR EACH ROW EXECUTE FUNCTION mumu_reject_immutable_change();
