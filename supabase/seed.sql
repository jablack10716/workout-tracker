-- Seed File for Default Exercise Library

-- 1. Create System Seed User in auth.users
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, aud, role)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    'system@weightlog.local',
    '',
    NOW(),
    'authenticated',
    'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Helper CTE to populate exercises and muscle groups
WITH new_exercises AS (
    INSERT INTO exercises (id, user_id, name, is_bodyweight_only, default_rest_timer_seconds) VALUES
    ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'Barbell Bench Press', false, 120),
    ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'Incline Dumbbell Press', false, 90),
    ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'Barbell Back Squat', false, 180),
    ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'Romanian Deadlift', false, 120),
    ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'Pull-Up', true, 90),
    ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'Barbell Bent Over Row', false, 90),
    ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'Overhead Dumbbell Press', false, 90),
    ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'Lateral Dumbbell Raise', false, 60),
    ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'Barbell Bicep Curl', false, 60),
    ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'Tricep Rope Pushdown', false, 60),
    ('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'Dips', true, 90),
    ('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'Leg Extension', false, 60)
    ON CONFLICT (id) DO NOTHING
)
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, fraction) VALUES
-- Barbell Bench Press (Chest 1.0, Shoulders 0.5, Triceps 0.5)
('a0000000-0000-0000-0000-000000000001', 'Chest', 1.0),
('a0000000-0000-0000-0000-000000000001', 'Shoulders', 0.5),
('a0000000-0000-0000-0000-000000000001', 'Triceps', 0.5),

-- Incline Dumbbell Press (Chest 1.0, Shoulders 0.5)
('a0000000-0000-0000-0000-000000000002', 'Chest', 1.0),
('a0000000-0000-0000-0000-000000000002', 'Shoulders', 0.5),

-- Barbell Back Squat (Legs 1.0)
('a0000000-0000-0000-0000-000000000003', 'Legs', 1.0),

-- Romanian Deadlift (Legs 1.0, Back 0.5)
('a0000000-0000-0000-0000-000000000004', 'Legs', 1.0),
('a0000000-0000-0000-0000-000000000004', 'Back', 0.5),

-- Pull-Up (Back 1.0, Biceps 0.5)
('a0000000-0000-0000-0000-000000000005', 'Back', 1.0),
('a0000000-0000-0000-0000-000000000005', 'Biceps', 0.5),

-- Barbell Row (Back 1.0, Biceps 0.5)
('a0000000-0000-0000-0000-000000000006', 'Back', 1.0),
('a0000000-0000-0000-0000-000000000006', 'Biceps', 0.5),

-- Overhead Dumbbell Press (Shoulders 1.0, Triceps 0.5)
('a0000000-0000-0000-0000-000000000007', 'Shoulders', 1.0),
('a0000000-0000-0000-0000-000000000007', 'Triceps', 0.5),

-- Lateral Dumbbell Raise (Shoulders 1.0)
('a0000000-0000-0000-0000-000000000008', 'Shoulders', 1.0),

-- Barbell Bicep Curl (Biceps 1.0)
('a0000000-0000-0000-0000-000000000009', 'Biceps', 1.0),

-- Tricep Rope Pushdown (Triceps 1.0)
('a0000000-0000-0000-0000-000000000010', 'Triceps', 1.0),

-- Dips (Triceps 1.0, Chest 0.5)
('a0000000-0000-0000-0000-000000000011', 'Triceps', 1.0),
('a0000000-0000-0000-0000-000000000011', 'Chest', 0.5),

-- Leg Extension (Legs 1.0)
('a0000000-0000-0000-0000-000000000012', 'Legs', 1.0)
ON CONFLICT (exercise_id, muscle_group) DO NOTHING;
