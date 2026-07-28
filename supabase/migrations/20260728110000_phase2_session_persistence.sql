-- Phase 2 Session Persistence & Lifecycle Correctness
-- Goals:
-- 1) Add missing duration_seconds column to sessions table.
-- 2) Add index for faster query performance on user history.

BEGIN;

-- Add duration_seconds column if it does not already exist
ALTER TABLE public.sessions 
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

-- Index for session queries ordered by started_at per user
CREATE INDEX IF NOT EXISTS idx_sessions_user_started 
ON public.sessions (user_id, started_at DESC);

COMMIT;
