-- Phase 1 Data-Safety, Safe Session History & Persisted Split Day Names
-- Goals:
-- 1) Convert sessions.routine_id, sessions.routine_day_id, and session_exercises.routine_exercise_id
--    foreign keys from ON DELETE CASCADE to ON DELETE SET NULL so deleting a routine or split day
--    never destroys historical workout logs, completed sets, or personal records.
-- 2) Add missing FK indexes on sessions(routine_day_id) and session_exercises(routine_exercise_id).
-- 3) Re-assert sessions, session_exercises, and session_sets RLS policies strictly via
--    sessions.user_id = (select auth.uid()) so orphaned sessions remain accessible and user-isolated.
-- 4) Add name TEXT column to public.routine_days.

BEGIN;

-- 1. Safely drop existing foreign keys regardless of constraint naming, then recreate with ON DELETE SET NULL
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT c.conname, c.conrelid::regclass AS table_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND (
        (c.conrelid = 'public.sessions'::regclass AND a.attname IN ('routine_id', 'routine_day_id'))
        OR (c.conrelid = 'public.session_exercises'::regclass AND a.attname = 'routine_exercise_id')
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_routine_id_fkey
    FOREIGN KEY (routine_id) REFERENCES public.routines(id) ON DELETE SET NULL,
  ADD CONSTRAINT sessions_routine_day_id_fkey
    FOREIGN KEY (routine_day_id) REFERENCES public.routine_days(id) ON DELETE SET NULL;

ALTER TABLE public.session_exercises
  ADD CONSTRAINT session_exercises_routine_exercise_id_fkey
    FOREIGN KEY (routine_exercise_id) REFERENCES public.routine_exercises(id) ON DELETE SET NULL;

-- 2. Index nullable foreign keys so ON DELETE SET NULL updates avoid sequential scans
CREATE INDEX IF NOT EXISTS idx_sessions_routine_day_id
  ON public.sessions (routine_day_id);

CREATE INDEX IF NOT EXISTS idx_session_exercises_routine_exercise_id
  ON public.session_exercises (routine_exercise_id);

-- 3. Re-assert RLS policies strictly via sessions.user_id = (select auth.uid())
DROP POLICY IF EXISTS "Users can manage their own sessions" ON public.sessions;
CREATE POLICY "Users can manage their own sessions"
ON public.sessions FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage session exercises" ON public.session_exercises;
CREATE POLICY "Users can manage session exercises"
ON public.session_exercises FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sessions
    WHERE sessions.id = session_exercises.session_id
      AND sessions.user_id = (select auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sessions
    WHERE sessions.id = session_exercises.session_id
      AND sessions.user_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can manage session sets" ON public.session_sets;
CREATE POLICY "Users can manage session sets"
ON public.session_sets FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.session_exercises
    JOIN public.sessions ON sessions.id = session_exercises.session_id
    WHERE session_exercises.id = session_sets.session_exercise_id
      AND sessions.user_id = (select auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.session_exercises
    JOIN public.sessions ON sessions.id = session_exercises.session_id
    WHERE session_exercises.id = session_sets.session_exercise_id
      AND sessions.user_id = (select auth.uid())
  )
);

-- 4. Persist custom split day names on routine_days
ALTER TABLE public.routine_days
  ADD COLUMN IF NOT EXISTS name TEXT;

COMMIT;
