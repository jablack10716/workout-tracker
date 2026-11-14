-- Phase 2: Superset Ergonomics, Split Editing & Science-Backed Programming Engine
-- 1) Relax routines.days_in_split CHECK constraint from 3..7 to 2..7
-- 2) Add target_rep_min and target_rep_max to routine_exercises and backfill from target_reps
-- 3) Add set_type and rir to session_sets

BEGIN;

-- 1a. Dynamically drop any CHECK constraint on public.routines referencing days_in_split
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.routines'::regclass
      AND c.contype = 'c'
      AND a.attname = 'days_in_split'
  LOOP
    EXECUTE format('ALTER TABLE public.routines DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.routines
  ADD CONSTRAINT routines_days_in_split_check
  CHECK (days_in_split BETWEEN 2 AND 7);

-- 1b. Add target_rep_min & target_rep_max to public.routine_exercises and backfill from target_reps
ALTER TABLE public.routine_exercises
  ADD COLUMN IF NOT EXISTS target_rep_min INTEGER,
  ADD COLUMN IF NOT EXISTS target_rep_max INTEGER;

UPDATE public.routine_exercises
SET
  target_rep_min = COALESCE(target_rep_min, target_reps),
  target_rep_max = COALESCE(target_rep_max, target_reps)
WHERE target_reps IS NOT NULL
  AND (target_rep_min IS NULL OR target_rep_max IS NULL);

ALTER TABLE public.routine_exercises
  DROP CONSTRAINT IF EXISTS routine_exercises_rep_range_check;
ALTER TABLE public.routine_exercises
  ADD CONSTRAINT routine_exercises_rep_range_check
  CHECK (
    (target_rep_min IS NULL OR target_rep_min >= 1)
    AND (target_rep_max IS NULL OR target_rep_max >= 1)
    AND (target_rep_min IS NULL OR target_rep_max IS NULL OR target_rep_min <= target_rep_max)
  );

-- 1c. Add set_type and rir to public.session_sets
ALTER TABLE public.session_sets
  ADD COLUMN IF NOT EXISTS set_type TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS rir SMALLINT;

ALTER TABLE public.session_sets
  DROP CONSTRAINT IF EXISTS session_sets_set_type_check;
ALTER TABLE public.session_sets
  ADD CONSTRAINT session_sets_set_type_check
  CHECK (set_type IN ('normal', 'warmup', 'drop', 'failure'));

ALTER TABLE public.session_sets
  DROP CONSTRAINT IF EXISTS session_sets_rir_check;
ALTER TABLE public.session_sets
  ADD CONSTRAINT session_sets_rir_check
  CHECK (rir BETWEEN 0 AND 5);

NOTIFY pgrst, 'reload schema';

COMMIT;
