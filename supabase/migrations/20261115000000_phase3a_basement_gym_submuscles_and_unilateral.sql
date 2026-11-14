-- Phase 3A (Basement Express Edition):
-- 1) Extend muscle_group enum to 11 sub-muscles (OUTSIDE transaction per PostgreSQL rule)
-- 2) Ensure system seed user exists (Guardrail #1)
-- 3) Add exercises.is_unilateral and exercises.equipment
-- 4) Backfill equipment & sub-muscles on original 12 seeds and safely migrate custom rows
-- 5) Seed 18 Basement Express exercises (...0013..0030) with 60s rest defaults

ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Lats';
ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Upper Back';
ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Quads';
ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Hamstrings';
ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Glutes';
ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Calves';

BEGIN;

-- Guardrail #1: Ensure system seed user exists before any FK-dependent upserts
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

-- Add unilateral & equipment metadata to exercises
ALTER TABLE public.exercises
    ADD COLUMN IF NOT EXISTS is_unilateral BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS equipment TEXT NOT NULL DEFAULT 'dumbbell';

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
        WHERE c.conrelid = 'public.exercises'::regclass
          AND c.contype = 'c'
          AND a.attname = 'equipment'
    LOOP
        EXECUTE format('ALTER TABLE public.exercises DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.exercises
    ADD CONSTRAINT exercises_equipment_check
    CHECK (equipment IN (
        'dumbbell',
        'bodyweight',
        'pullup_dip_bar',
        'barbell',
        'cable',
        'machine',
        'kettlebell',
        'band'
    ));

-- Ensure & backfill the original 12 system exercises
INSERT INTO public.exercises (id, user_id, name, is_bodyweight_only, default_rest_timer_seconds, is_unilateral, equipment) VALUES
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
('a0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'Leg Extension', false, 60, false, 'machine')
ON CONFLICT (id) DO UPDATE
SET
    is_unilateral = EXCLUDED.is_unilateral,
    equipment = EXCLUDED.equipment;

-- Backfill any existing user-created bodyweight exercises that have not been classified yet
UPDATE public.exercises
SET equipment = 'bodyweight'
WHERE is_bodyweight_only = TRUE
  AND equipment = 'dumbbell';

-- Clear coarse Back/Legs mappings on original system seeds before inserting sub-muscle splits
DELETE FROM public.exercise_muscle_groups
WHERE exercise_id IN (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000011',
    'a0000000-0000-0000-0000-000000000012'
)
AND muscle_group IN ('Back', 'Legs');

-- Collision-safe migration for remaining custom 'Back' / 'Legs' rows
INSERT INTO public.exercise_muscle_groups (exercise_id, muscle_group, fraction)
SELECT emg.exercise_id, 'Upper Back'::public.muscle_group, emg.fraction
FROM public.exercise_muscle_groups emg
WHERE emg.muscle_group = 'Back'
ON CONFLICT (exercise_id, muscle_group) DO UPDATE
SET fraction = GREATEST(public.exercise_muscle_groups.fraction, EXCLUDED.fraction);

DELETE FROM public.exercise_muscle_groups WHERE muscle_group = 'Back';

INSERT INTO public.exercise_muscle_groups (exercise_id, muscle_group, fraction)
SELECT emg.exercise_id, 'Quads'::public.muscle_group, emg.fraction
FROM public.exercise_muscle_groups emg
WHERE emg.muscle_group = 'Legs'
ON CONFLICT (exercise_id, muscle_group) DO UPDATE
SET fraction = GREATEST(public.exercise_muscle_groups.fraction, EXCLUDED.fraction);

DELETE FROM public.exercise_muscle_groups WHERE muscle_group = 'Legs';

-- Seed 18 Basement Express exercises (50 lb Adjustable Dumbbells + Incline Bench + Bodyweight, 60s rest)
INSERT INTO public.exercises (id, user_id, name, is_bodyweight_only, default_rest_timer_seconds, is_unilateral, equipment) VALUES
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
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    is_bodyweight_only = EXCLUDED.is_bodyweight_only,
    default_rest_timer_seconds = EXCLUDED.default_rest_timer_seconds,
    is_unilateral = EXCLUDED.is_unilateral,
    equipment = EXCLUDED.equipment;

-- Guardrail #1: Guard all muscle group upserts with WHERE EXISTS against public.exercises
WITH target_muscles(exercise_id, muscle_group, fraction) AS (
    VALUES
    -- Original 12 remapped to 11-sub-muscle taxonomy
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'Chest'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'Shoulders'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'Triceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'Chest'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'Shoulders'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000003'::uuid, 'Quads'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000003'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000004'::uuid, 'Hamstrings'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000004'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000004'::uuid, 'Upper Back'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000005'::uuid, 'Lats'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000005'::uuid, 'Biceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000006'::uuid, 'Upper Back'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000006'::uuid, 'Lats'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000006'::uuid, 'Biceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000007'::uuid, 'Shoulders'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000007'::uuid, 'Triceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000008'::uuid, 'Shoulders'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000009'::uuid, 'Biceps'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000010'::uuid, 'Triceps'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000011'::uuid, 'Triceps'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000011'::uuid, 'Chest'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000012'::uuid, 'Quads'::public.muscle_group, 1.0::numeric(2,1)),

    -- 18 Basement Express exercises (...0013..0030)
    ('a0000000-0000-0000-0000-000000000013'::uuid, 'Chest'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000013'::uuid, 'Triceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000013'::uuid, 'Shoulders'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000014'::uuid, 'Chest'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000015'::uuid, 'Chest'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000015'::uuid, 'Triceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000015'::uuid, 'Shoulders'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000016'::uuid, 'Lats'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000016'::uuid, 'Upper Back'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000016'::uuid, 'Biceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000017'::uuid, 'Upper Back'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000017'::uuid, 'Lats'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000017'::uuid, 'Biceps'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000018'::uuid, 'Lats'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000018'::uuid, 'Chest'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000019'::uuid, 'Upper Back'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000019'::uuid, 'Shoulders'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000020'::uuid, 'Quads'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000020'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000021'::uuid, 'Quads'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000021'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000022'::uuid, 'Hamstrings'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000022'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000022'::uuid, 'Upper Back'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000023'::uuid, 'Hamstrings'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000023'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000024'::uuid, 'Quads'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000024'::uuid, 'Glutes'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000025'::uuid, 'Glutes'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000025'::uuid, 'Hamstrings'::public.muscle_group, 0.5::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000026'::uuid, 'Calves'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000027'::uuid, 'Biceps'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000028'::uuid, 'Biceps'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000029'::uuid, 'Triceps'::public.muscle_group, 1.0::numeric(2,1)),
    ('a0000000-0000-0000-0000-000000000030'::uuid, 'Core'::public.muscle_group, 1.0::numeric(2,1))
)
INSERT INTO public.exercise_muscle_groups (exercise_id, muscle_group, fraction)
SELECT tm.exercise_id, tm.muscle_group, tm.fraction
FROM target_muscles tm
WHERE EXISTS (
    SELECT 1 FROM public.exercises e WHERE e.id = tm.exercise_id
)
ON CONFLICT (exercise_id, muscle_group) DO UPDATE
SET fraction = EXCLUDED.fraction;

NOTIFY pgrst, 'reload schema';

COMMIT;
