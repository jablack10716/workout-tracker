-- Row Level Security (RLS) Policies

-- 1. Exercises
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own or system default exercises" 
ON exercises FOR SELECT USING (auth.uid() = user_id OR user_id = '00000000-0000-0000-0000-000000000000');

CREATE POLICY "Users can insert their own exercises" 
ON exercises FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update exercises" 
ON exercises FOR UPDATE USING (auth.uid() = user_id OR user_id = '00000000-0000-0000-0000-000000000000');

CREATE POLICY "Users can delete exercises" 
ON exercises FOR DELETE USING (auth.uid() = user_id OR user_id = '00000000-0000-0000-0000-000000000000');

-- 1.2 Exercise Muscle Groups
ALTER TABLE exercise_muscle_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage muscle groups for their exercises" 
ON exercise_muscle_groups FOR ALL USING (
    EXISTS (
        SELECT 1 FROM exercises 
        WHERE exercises.id = exercise_muscle_groups.exercise_id 
        AND (exercises.user_id = auth.uid() OR exercises.user_id = '00000000-0000-0000-0000-000000000000')
    )
);

-- 2. Routines
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own routines" 
ON routines FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Routine Days
ALTER TABLE routine_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage routine days" 
ON routine_days FOR ALL USING (
    EXISTS (
        SELECT 1 FROM routines 
        WHERE routines.id = routine_days.routine_id 
        AND routines.user_id = auth.uid()
    )
);

-- Routine Exercises
ALTER TABLE routine_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage routine exercises" 
ON routine_exercises FOR ALL USING (
    EXISTS (
        SELECT 1 FROM routine_days 
        JOIN routines ON routines.id = routine_days.routine_id
        WHERE routine_days.id = routine_exercises.routine_day_id 
        AND routines.user_id = auth.uid()
    )
);

-- 3. Sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own sessions" 
ON sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Session Exercises
ALTER TABLE session_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage session exercises" 
ON session_exercises FOR ALL USING (
    EXISTS (
        SELECT 1 FROM sessions 
        WHERE sessions.id = session_exercises.session_id 
        AND sessions.user_id = auth.uid()
    )
);

-- Session Sets
ALTER TABLE session_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage session sets" 
ON session_sets FOR ALL USING (
    EXISTS (
        SELECT 1 FROM session_exercises
        JOIN sessions ON sessions.id = session_exercises.session_id
        WHERE session_exercises.id = session_sets.session_exercise_id 
        AND sessions.user_id = auth.uid()
    )
);

-- =========================================================
-- Schema & Table Grants for PostgREST Roles (authenticated & anon)
-- =========================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated;

