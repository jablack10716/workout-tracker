-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Custom Enums
CREATE TYPE routine_status AS ENUM ('draft', 'active', 'completed');
CREATE TYPE muscle_group AS ENUM ('Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps');
CREATE TYPE session_status AS ENUM ('in_progress', 'completed');

-- =========================================================
-- 1. Global Exercise Library
-- =========================================================

CREATE TABLE exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_bodyweight_only BOOLEAN NOT NULL DEFAULT FALSE,
    default_rest_timer_seconds INTEGER NOT NULL DEFAULT 90,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 Muscle Group Volume Mapping (Fractional Vectors)
CREATE TABLE exercise_muscle_groups (
    exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE,
    muscle_group muscle_group NOT NULL,
    fraction DECIMAL(2,1) NOT NULL CHECK (fraction IN (0.5, 1.0)),
    PRIMARY KEY (exercise_id, muscle_group)
);

-- =========================================================
-- 2. Routine Builder ("Sandbox Mode")
-- =========================================================

CREATE TABLE routines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status routine_status NOT NULL DEFAULT 'draft',
    days_in_split INTEGER NOT NULL CHECK (days_in_split BETWEEN 3 AND 7),
    cycles_per_routine INTEGER NOT NULL CHECK (cycles_per_routine >= 1),
    
    -- Tracks horizontal progression
    current_day INTEGER NOT NULL DEFAULT 1,
    current_cycle INTEGER NOT NULL DEFAULT 1,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE routine_days (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    routine_id UUID REFERENCES routines(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL, -- 1 to days_in_split
    UNIQUE (routine_id, day_number)
);

CREATE TABLE routine_exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    routine_day_id UUID REFERENCES routine_days(id) ON DELETE CASCADE,
    exercise_id UUID REFERENCES exercises(id) ON DELETE RESTRICT,
    order_index INTEGER NOT NULL,
    planned_sets INTEGER NOT NULL CHECK (planned_sets >= 1),
    
    -- Baseline target from cloned routine (Starting point for Cycle 1)
    target_weight DECIMAL(6,2), 
    target_reps INTEGER,
    
    UNIQUE (routine_day_id, order_index)
);

-- =========================================================
-- 3 & 4 & 5. Active Logging & Cycle Rotation Engine
-- =========================================================

-- Represents a specific Day's workout in a specific Cycle
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    routine_id UUID REFERENCES routines(id) ON DELETE CASCADE,
    routine_day_id UUID REFERENCES routine_days(id) ON DELETE CASCADE,
    
    cycle_number INTEGER NOT NULL,
    status session_status NOT NULL DEFAULT 'in_progress',
    
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (routine_id, routine_day_id, cycle_number)
);

-- 5. "Fresh Memory" Targeting (Next Target Weight/Reps)
CREATE TABLE session_exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    routine_exercise_id UUID REFERENCES routine_exercises(id) ON DELETE CASCADE,
    
    -- Captured after completing the exercise in this session, 
    -- to be used as the recommendation in cycle X+1.
    next_target_weight DECIMAL(6,2),
    next_target_reps INTEGER,
    
    UNIQUE (session_id, routine_exercise_id)
);

-- 4.2 Logged Sets (Set-by-Set Data)
CREATE TABLE session_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_exercise_id UUID REFERENCES session_exercises(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    weight DECIMAL(6,2), -- Null if bodyweight_only is true
    reps INTEGER,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_exercise_id, set_number)
);
