-- Migration: Add Superset and Giant Set Support
-- Description: Adds superset_id and superset_order to routine_exercises and session_exercises tables.

BEGIN;

-- Add superset columns to routine_exercises
ALTER TABLE public.routine_exercises
ADD COLUMN IF NOT EXISTS superset_id TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS superset_order INTEGER DEFAULT 1;

-- Add superset columns to session_exercises
ALTER TABLE public.session_exercises
ADD COLUMN IF NOT EXISTS superset_id TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS superset_order INTEGER DEFAULT 1;

-- Create index for faster superset lookup during active workouts
CREATE INDEX IF NOT EXISTS idx_routine_exercises_superset 
ON public.routine_exercises (routine_day_id, superset_id);

CREATE INDEX IF NOT EXISTS idx_session_exercises_superset 
ON public.session_exercises (session_id, superset_id);

COMMIT;