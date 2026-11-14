-- Seed File for Default Exercise Library (Phase 3A: 30 Exercises, 11 Sub-Muscles, Unilateral & Equipment)

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

-- 2. Populate 30 system exercises (12 original + 18 Basement Express DB/BW lifts)
INSERT INTO exercises (id, user_id, name, is_bodyweight_only, default_rest_timer_seconds, is_unilateral, equipment) VALUES
('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'Barbell Bench Press', false, 120, false, 'barbell'),
('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'Incline Dumbbell Press', false, 90, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'Barbell Back Squat', false, 180, false, 'barbell'),
('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'Romanian Deadlift', false, 120, false, 'barbell'),
('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'Pull-Up', true, 90, false, 'pullup_dip_bar'),
('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'Barbell Bent Over Row', false, 90, false, 'barbell'),
('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'Overhead Dumbbell Press', false, 90, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'Lateral Dumbbell Raise', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'Barbell Bicep Curl', false, 60, false, 'barbell'),
('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'Tricep Rope Pushdown', false, 60, false, 'cable'),
('a0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'Dips', true, 90, false, 'pullup_dip_bar'),
('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'Leg Extension', false, 60, false, 'machine'),
-- Basement Express Edition (50 lb Adjustable Dumbbells + Incline Bench + Bodyweight)
('a0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'Flat Dumbbell Bench Press', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'Dumbbell Chest Fly', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'Push-Up', true, 60, false, 'bodyweight'),
('a0000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'One-Arm Dumbbell Row', false, 60, true, 'dumbbell'),
('a0000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000000', 'Chest-Supported Incline DB Row', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000000', 'Dumbbell Pullover', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-000000000000', 'Dumbbell Rear Delt Fly', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'Dumbbell Bulgarian Split Squat', false, 60, true, 'dumbbell'),
('a0000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'Dumbbell Goblet Squat', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000000', 'Dumbbell Romanian Deadlift', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000000', 'Single-Leg Dumbbell RDL', false, 60, true, 'dumbbell'),
('a0000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000000', 'Dumbbell Reverse Lunge', false, 60, true, 'dumbbell'),
('a0000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000000', 'Dumbbell Hip Thrust', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000000', 'Standing Single-Leg Dumbbell Calf Raise', false, 60, true, 'dumbbell'),
('a0000000-0000-0000-0000-000000000027', '00000000-0000-0000-0000-000000000000', 'Incline Dumbbell Bicep Curl', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000028', '00000000-0000-0000-0000-000000000000', 'Dumbbell Hammer Curl', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000000', 'Overhead Dumbbell Tricep Extension', false, 60, false, 'dumbbell'),
('a0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000000', 'Hollow Body Hold / Decline Crunch', true, 60, false, 'bodyweight')
ON CONFLICT (id) DO NOTHING;

-- 3. Populate 11-sub-muscle mappings for all 30 system exercises
INSERT INTO exercise_muscle_groups (exercise_id, muscle_group, fraction) VALUES
-- Barbell Bench Press
('a0000000-0000-0000-0000-000000000001', 'Chest', 1.0),
('a0000000-0000-0000-0000-000000000001', 'Shoulders', 0.5),
('a0000000-0000-0000-0000-000000000001', 'Triceps', 0.5),
-- Incline Dumbbell Press
('a0000000-0000-0000-0000-000000000002', 'Chest', 1.0),
('a0000000-0000-0000-0000-000000000002', 'Shoulders', 0.5),
-- Barbell Back Squat
('a0000000-0000-0000-0000-000000000003', 'Quads', 1.0),
('a0000000-0000-0000-0000-000000000003', 'Glutes', 0.5),
-- Romanian Deadlift
('a0000000-0000-0000-0000-000000000004', 'Hamstrings', 1.0),
('a0000000-0000-0000-0000-000000000004', 'Glutes', 0.5),
('a0000000-0000-0000-0000-000000000004', 'Upper Back', 0.5),
-- Pull-Up
('a0000000-0000-0000-0000-000000000005', 'Lats', 1.0),
('a0000000-0000-0000-0000-000000000005', 'Biceps', 0.5),
-- Barbell Bent Over Row
('a0000000-0000-0000-0000-000000000006', 'Upper Back', 1.0),
('a0000000-0000-0000-0000-000000000006', 'Lats', 0.5),
('a0000000-0000-0000-0000-000000000006', 'Biceps', 0.5),
-- Overhead Dumbbell Press
('a0000000-0000-0000-0000-000000000007', 'Shoulders', 1.0),
('a0000000-0000-0000-0000-000000000007', 'Triceps', 0.5),
-- Lateral Dumbbell Raise
('a0000000-0000-0000-0000-000000000008', 'Shoulders', 1.0),
-- Barbell Bicep Curl
('a0000000-0000-0000-0000-000000000009', 'Biceps', 1.0),
-- Tricep Rope Pushdown
('a0000000-0000-0000-0000-000000000010', 'Triceps', 1.0),
-- Dips
('a0000000-0000-0000-0000-000000000011', 'Triceps', 1.0),
('a0000000-0000-0000-0000-000000000011', 'Chest', 0.5),
-- Leg Extension
('a0000000-0000-0000-0000-000000000012', 'Quads', 1.0),
-- Flat Dumbbell Bench Press
('a0000000-0000-0000-0000-000000000013', 'Chest', 1.0),
('a0000000-0000-0000-0000-000000000013', 'Triceps', 0.5),
('a0000000-0000-0000-0000-000000000013', 'Shoulders', 0.5),
-- Dumbbell Chest Fly
('a0000000-0000-0000-0000-000000000014', 'Chest', 1.0),
-- Push-Up
('a0000000-0000-0000-0000-000000000015', 'Chest', 1.0),
('a0000000-0000-0000-0000-000000000015', 'Triceps', 0.5),
('a0000000-0000-0000-0000-000000000015', 'Shoulders', 0.5),
-- One-Arm Dumbbell Row
('a0000000-0000-0000-0000-000000000016', 'Lats', 1.0),
('a0000000-0000-0000-0000-000000000016', 'Upper Back', 0.5),
('a0000000-0000-0000-0000-000000000016', 'Biceps', 0.5),
-- Chest-Supported Incline DB Row
('a0000000-0000-0000-0000-000000000017', 'Upper Back', 1.0),
('a0000000-0000-0000-0000-000000000017', 'Lats', 0.5),
('a0000000-0000-0000-0000-000000000017', 'Biceps', 0.5),
-- Dumbbell Pullover
('a0000000-0000-0000-0000-000000000018', 'Lats', 1.0),
('a0000000-0000-0000-0000-000000000018', 'Chest', 0.5),
-- Dumbbell Rear Delt Fly
('a0000000-0000-0000-0000-000000000019', 'Upper Back', 1.0),
('a0000000-0000-0000-0000-000000000019', 'Shoulders', 0.5),
-- Dumbbell Bulgarian Split Squat
('a0000000-0000-0000-0000-000000000020', 'Quads', 1.0),
('a0000000-0000-0000-0000-000000000020', 'Glutes', 0.5),
-- Dumbbell Goblet Squat
('a0000000-0000-0000-0000-000000000021', 'Quads', 1.0),
('a0000000-0000-0000-0000-000000000021', 'Glutes', 0.5),
-- Dumbbell Romanian Deadlift
('a0000000-0000-0000-0000-000000000022', 'Hamstrings', 1.0),
('a0000000-0000-0000-0000-000000000022', 'Glutes', 0.5),
('a0000000-0000-0000-0000-000000000022', 'Upper Back', 0.5),
-- Single-Leg Dumbbell RDL
('a0000000-0000-0000-0000-000000000023', 'Hamstrings', 1.0),
('a0000000-0000-0000-0000-000000000023', 'Glutes', 0.5),
-- Dumbbell Reverse Lunge
('a0000000-0000-0000-0000-000000000024', 'Quads', 1.0),
('a0000000-0000-0000-0000-000000000024', 'Glutes', 0.5),
-- Dumbbell Hip Thrust
('a0000000-0000-0000-0000-000000000025', 'Glutes', 1.0),
('a0000000-0000-0000-0000-000000000025', 'Hamstrings', 0.5),
-- Standing Single-Leg Dumbbell Calf Raise
('a0000000-0000-0000-0000-000000000026', 'Calves', 1.0),
-- Incline Dumbbell Bicep Curl
('a0000000-0000-0000-0000-000000000027', 'Biceps', 1.0),
-- Dumbbell Hammer Curl
('a0000000-0000-0000-0000-000000000028', 'Biceps', 1.0),
-- Overhead Dumbbell Tricep Extension
('a0000000-0000-0000-0000-000000000029', 'Triceps', 1.0),
-- Hollow Body Hold / Decline Crunch
('a0000000-0000-0000-0000-000000000030', 'Core', 1.0)
ON CONFLICT (exercise_id, muscle_group) DO NOTHING;
