-- Migration: Add 'Core' to muscle_group enum
-- Description: Extends the muscle_group enum type with 'Core' for exercises such as crunches, sit-ups, planks, etc.

ALTER TYPE public.muscle_group ADD VALUE IF NOT EXISTS 'Core';
