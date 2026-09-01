CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  region text NOT NULL DEFAULT '' CHECK (char_length(region) <= 120),
  school_code text CHECK (school_code IS NULL OR char_length(school_code) BETWEEN 1 AND 40),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, name)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS school_members (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  teacher_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, teacher_id)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS school_members_teacher ON school_members (teacher_id, role);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS school_curriculum_plans (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year integer NOT NULL CHECK (school_year BETWEEN 2022 AND 2100),
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('draft', 'approved', 'retired')),
  school_basics jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(school_basics) = 'object'),
  grade_templates jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(grade_templates) = 'array'),
  source_documents jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_documents) = 'array'),
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'draft' AND approved_at IS NULL AND approved_by IS NULL)
    OR (state IN ('approved', 'retired') AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  UNIQUE (school_id, school_year, version)
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS school_curriculum_active_plans (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year integer NOT NULL CHECK (school_year BETWEEN 2022 AND 2100),
  plan_id uuid NOT NULL UNIQUE REFERENCES school_curriculum_plans(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, school_year)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS school_curriculum_plan_history
  ON school_curriculum_plans (school_id, school_year DESC, version DESC);
-- statement-breakpoint
ALTER TABLE curriculum_terms
  ADD COLUMN IF NOT EXISTS source_school_plan_id uuid REFERENCES school_curriculum_plans(id) ON DELETE RESTRICT;
-- statement-breakpoint
ALTER TABLE curriculum_terms
  ADD COLUMN IF NOT EXISTS source_template_key text;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS curriculum_terms_source_plan
  ON curriculum_terms (source_school_plan_id, source_template_key) WHERE source_school_plan_id IS NOT NULL;
