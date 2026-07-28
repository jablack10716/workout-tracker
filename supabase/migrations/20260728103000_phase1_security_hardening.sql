-- Phase 1 Security Hardening
-- Goals:
-- 1) Remove broad grants to anon/authenticated.
-- 2) Make system exercise library rows read-only for normal users.
-- 3) Tighten exercise_muscle_groups ownership semantics.

BEGIN;

-- =========================================================
-- Policy hardening: exercises
-- =========================================================
DROP POLICY IF EXISTS "Users can update exercises" ON exercises;
DROP POLICY IF EXISTS "Users can delete exercises" ON exercises;

-- Keep user-created rows mutable only by owner.
CREATE POLICY "Users can update their own exercises"
ON exercises FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own exercises"
ON exercises FOR DELETE
USING (auth.uid() = user_id);

-- =========================================================
-- Policy hardening: exercise_muscle_groups
-- =========================================================
DROP POLICY IF EXISTS "Users can manage muscle groups for their exercises" ON exercise_muscle_groups;

-- Read mappings for own exercises and system library exercises.
CREATE POLICY "Users can view muscle groups for own or system exercises"
ON exercise_muscle_groups FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM exercises
    WHERE exercises.id = exercise_muscle_groups.exercise_id
      AND (
        exercises.user_id = auth.uid()
        OR exercises.user_id = '00000000-0000-0000-0000-000000000000'
      )
  )
);

-- Mutate mappings for owned exercises only.
CREATE POLICY "Users can insert muscle groups for own exercises"
ON exercise_muscle_groups FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM exercises
    WHERE exercises.id = exercise_muscle_groups.exercise_id
      AND exercises.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update muscle groups for own exercises"
ON exercise_muscle_groups FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM exercises
    WHERE exercises.id = exercise_muscle_groups.exercise_id
      AND exercises.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM exercises
    WHERE exercises.id = exercise_muscle_groups.exercise_id
      AND exercises.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete muscle groups for own exercises"
ON exercise_muscle_groups FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM exercises
    WHERE exercises.id = exercise_muscle_groups.exercise_id
      AND exercises.user_id = auth.uid()
  )
);

-- =========================================================
-- Grants hardening
-- =========================================================
-- Remove broad grants first.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

-- Keep schema usage for authenticated app clients.
REVOKE USAGE ON SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Table-level least-privilege grants for authenticated role.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exercise_muscle_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE routines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE routine_days TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE routine_exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_sets TO authenticated;

-- Do not auto-expose future objects to anon/authenticated.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

COMMIT;
