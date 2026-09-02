CREATE TABLE IF NOT EXISTS teacher_classes (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  school_id uuid REFERENCES schools(id) ON DELETE RESTRICT,
  school_year integer NOT NULL CHECK (school_year BETWEEN 2022 AND 2100),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 6),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, school_year, grade, name)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS teacher_classes_owner_year
  ON teacher_classes (owner_id, school_year DESC, grade, name);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS class_students (
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES teacher_classes(id) ON DELETE RESTRICT,
  student_ref text NOT NULL CHECK (char_length(student_ref) BETWEEN 1 AND 80),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_ref)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS class_students_class_active
  ON class_students (class_id, active, student_ref);
-- statement-breakpoint
ALTER TABLE curriculum_terms
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES teacher_classes(id) ON DELETE RESTRICT;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS curriculum_terms_class
  ON curriculum_terms (class_id, semester, subject) WHERE class_id IS NOT NULL;
-- statement-breakpoint
ALTER TABLE curriculum_students
  ADD COLUMN IF NOT EXISTS class_student_id uuid REFERENCES class_students(id) ON DELETE RESTRICT;
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_students_term_class_student
  ON curriculum_students (term_id, class_student_id) WHERE class_student_id IS NOT NULL;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS assessment_distributions (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES teacher_classes(id) ON DELETE RESTRICT,
  share_code text NOT NULL UNIQUE CHECK (share_code ~ '^[A-F0-9]{16}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 2000),
  closes_at timestamptz,
  created_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  UNIQUE (assessment_id, class_id)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS assessment_distributions_class_status
  ON assessment_distributions (class_id, status, created_at DESC);
-- statement-breakpoint
ALTER TABLE student_attempts
  ADD COLUMN IF NOT EXISTS distribution_id uuid REFERENCES assessment_distributions(id) ON DELETE RESTRICT;
-- statement-breakpoint
ALTER TABLE student_attempts
  ADD COLUMN IF NOT EXISTS class_student_id uuid REFERENCES class_students(id) ON DELETE RESTRICT;
-- statement-breakpoint
ALTER TABLE student_attempts
  DROP CONSTRAINT IF EXISTS student_attempts_distribution_student_check;
-- statement-breakpoint
ALTER TABLE student_attempts
  ADD CONSTRAINT student_attempts_distribution_student_check
  CHECK ((distribution_id IS NULL) = (class_student_id IS NULL));
-- statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS attempts_distribution_student
  ON student_attempts (distribution_id, class_student_id) WHERE distribution_id IS NOT NULL;
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS attempts_distribution_status
  ON student_attempts (distribution_id, status, submitted_at DESC) WHERE distribution_id IS NOT NULL;
