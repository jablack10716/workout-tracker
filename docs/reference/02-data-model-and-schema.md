> **Reference Pack Metadata**
> - **App Name:** Best Damn Weight Lifting Tracker Ever (`weightliftinglog` / UI Banner: *Best Damn Workout Tracker Ever*)
> - **Git Commit SHA & Branch:** `9a6f80e` (`main`) + Phase 1 Working Tree Updates — Base Commit `2026-09-30 18:54:32 -0500`
> - **Snapshot Date:** `2026-11-13`
> - **File Scope:** Complete PostgreSQL & client-side storage inventory, table columns/types/constraints/indexes, RLS security model, Mermaid ER diagram, migration history, seed catalog, and import/export capabilities.

# 02 — Data Model & Schema

## 1. Storage Inventory Overview

| Storage Layer | Count | Summary |
| :--- | :--- | :--- |
| **PostgreSQL Tables (`public`)** | **8** | `exercises`, `exercise_muscle_groups`, `routines`, `routine_days`, `routine_exercises`, `sessions`, `session_exercises`, `session_sets` (plus FK dependency on `auth.users`) |
| **PostgreSQL Custom Enums** | **3** | `routine_status`, `muscle_group`, `session_status` |
| **SQL Migrations** | **7** | Sequential additive DDL, RLS hardening, & data-safety scripts in `supabase/migrations/` |
| **Client-Side Zustand Stores** | **2** | `useActiveWorkoutStore` (`src/store/useActiveWorkoutStore.ts`) & `usePreferencesStore` (`src/store/usePreferencesStore.ts`) |
| **AsyncStorage Namespaces** | **3** | `@supabase/supabase-js` Auth JWT session, `'weightlifting-active-workout-v1'`, and `'weightlifting-preferences-v1'` |

---

## 2. Custom PostgreSQL Enum Types

Defined in `20260713165135_initial_schema.sql` and extended in `20260820000000_add_core_muscle_group.sql`:

| Enum Name | Allowed Values | Notes |
| :--- | :--- | :--- |
| `routine_status` | `'draft'`, `'active'`, `'completed'` | `'completed'` is never written by current app code (cycles increment indefinitely). |
| `muscle_group` | `'Chest'`, `'Back'`, `'Shoulders'`, `'Legs'`, `'Biceps'`, `'Triceps'`, `'Core'` | `'Core'` was appended in migration 6 via `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'Core'`. |
| `session_status` | `'in_progress'`, `'completed'` | Column defaults to `'in_progress'`, but `app/workout/complete.tsx` inserts directly with `'completed'`. |

---

## 3. Complete Table & Column Inventory (`public` Schema)

All UUID primary keys use `uuid_generate_v4()` from the `uuid-ossp` extension.

### 3.1 `exercises`
Master library containing both immutable system-seeded exercises (`user_id = '00000000-0000-0000-0000-000000000000'`) and user-created custom exercises.

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `user_id` | `UUID` | `NOT NULL` | — | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `name` | `TEXT` | `NOT NULL` | — | Exercise display name |
| `is_bodyweight_only` | `BOOLEAN` | `NOT NULL` | `FALSE` | Flags bodyweight exercises |
| `default_rest_timer_seconds` | `INTEGER` | `NOT NULL` | `90` | Rest countdown duration triggered on set completion |
| `created_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Updated manually in app writes (no DB trigger) |

### 3.2 `exercise_muscle_groups`
Fractional muscle-synergy join table mapping each exercise to one primary (`1.0`) and zero or more secondary (`0.5`) muscle groups.

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `exercise_id` | `UUID` | `NOT NULL` | — | `PK (part 1)`, `REFERENCES exercises(id) ON DELETE CASCADE` |
| `muscle_group` | `muscle_group` | `NOT NULL` | — | `PK (part 2)`, enum value |
| `fraction` | `DECIMAL(2,1)` | `NOT NULL` | — | `CHECK (fraction IN (0.5, 1.0))` |

### 3.3 `routines`
Top-level training split configuration and active sequential queue pointer (`current_day`, `current_cycle`).

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `user_id` | `UUID` | `NOT NULL` | — | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `name` | `TEXT` | `NOT NULL` | — | Routine display title |
| `status` | `routine_status` | `NOT NULL` | `'draft'` | App enforces single `'active'` routine in client code (no partial unique DB index) |
| `days_in_split` | `INTEGER` | `NOT NULL` | — | `CHECK (days_in_split BETWEEN 3 AND 7)` |
| `cycles_per_routine` | `INTEGER` | `NOT NULL` | — | `CHECK (cycles_per_routine >= 1)` |
| `current_day` | `INTEGER` | `NOT NULL` | `1` | Horizontal queue pointer (`1 .. days_in_split`) |
| `current_cycle` | `INTEGER` | `NOT NULL` | `1` | Current rotation cycle (`1 .. N`) |
| `created_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Updated on routine creation & workout completion |

### 3.4 `routine_days`
Discrete split days belonging to a routine (`1 .. days_in_split`).

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `routine_id` | `UUID` | `NULL` | — | `REFERENCES routines(id) ON DELETE CASCADE`, `UNIQUE (routine_id, day_number)` |
| `day_number` | `INTEGER` | `NOT NULL` | — | `1`-based split index; `UNIQUE (routine_id, day_number)` |
| `name` | `TEXT` | `NULL` | — | Custom split day label added in migration 7 (`20261113000000_data_safety_and_day_names.sql`) |

> **Schema Compatibility Note:** `app/routine-builder/new.tsx` persists `day.name` into `routine_days.name` and includes a safe fallback retry without `name` if a remote PostgREST schema cache lags behind migration 7 (matching the existing `superset_id` fallback pattern).

### 3.5 `routine_exercises`
Ordered exercise prescriptions within a specific `routine_days` record, including superset grouping metadata.

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `routine_day_id` | `UUID` | `NULL` | — | `REFERENCES routine_days(id) ON DELETE CASCADE`, `UNIQUE (routine_day_id, order_index)` |
| `exercise_id` | `UUID` | `NULL` | — | `REFERENCES exercises(id) ON DELETE RESTRICT` (blocks deleting exercises used in routines) |
| `order_index` | `INTEGER` | `NOT NULL` | — | `1`-based position within day; `UNIQUE (routine_day_id, order_index)` |
| `planned_sets` | `INTEGER` | `NOT NULL` | — | `CHECK (planned_sets >= 1)` |
| `target_weight` | `DECIMAL(6,2)` | `NULL` | — | Baseline target load (`lbs` in UI); updated on workout completion |
| `target_reps` | `INTEGER` | `NULL` | — | Target reps per set (default `10` in UI) |
| `superset_id` | `TEXT` | `NULL` | `NULL` | Added in migration 5 (`ss_<timestamp>_<rand>`); links paired exercises |
| `superset_order` | `INTEGER` | `NULL` | `1` | Added in migration 5; `1`-based order inside superset (`A1`, `A2`, ...) |

### 3.6 `sessions`
Historical workout session header tying a user's completed workout to a user account, and optionally to a routine, split day, and cycle number.

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `user_id` | `UUID` | `NOT NULL` | — | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `routine_id` | `UUID` | `NULL` | — | `REFERENCES routines(id) ON DELETE SET NULL` (`sessions_routine_id_fkey`, updated in migration 7 — deleting a routine preserves sessions!) |
| `routine_day_id` | `UUID` | `NULL` | — | `REFERENCES routine_days(id) ON DELETE SET NULL` (`sessions_routine_day_id_fkey`, updated in migration 7) |
| `cycle_number` | `INTEGER` | `NOT NULL` | — | `UNIQUE (routine_id, routine_day_id, cycle_number)` |
| `status` | `session_status` | `NOT NULL` | `'in_progress'` | Always inserted as `'completed'` by `app/workout/complete.tsx` |
| `started_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Computed on save as `Date.now() - durationSeconds * 1000` |
| `completed_at` | `TIMESTAMPTZ` | `NULL` | — | Set to `new Date().toISOString()` on save |
| `duration_seconds` | `INTEGER` | `NULL` | — | Added in migration 4 (`Math.max(elapsed, 60)`) |

### 3.7 `session_exercises`
Per-exercise record within a logged workout session, storing superset metadata and the "Fresh Memory" target load for the next cycle.

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `session_id` | `UUID` | `NULL` | — | `REFERENCES sessions(id) ON DELETE CASCADE` |
| `routine_exercise_id` | `UUID` | `NULL` | — | `REFERENCES routine_exercises(id) ON DELETE SET NULL` (`session_exercises_routine_exercise_id_fkey`, updated in migration 7; app currently inserts `NULL`) |
| `exercise_id` | `UUID` | `NULL` | — | `REFERENCES exercises(id) ON DELETE CASCADE` |
| `next_target_weight` | `DECIMAL(6,2)` | `NULL` | — | Captured during active workout for cycle `X+1` |
| `next_target_reps` | `INTEGER` | `NULL` | — | **Unused:** app never writes this column (even for bodyweight exercises) |
| `superset_id` | `TEXT` | `NULL` | `NULL` | Added in migration 5 |
| `superset_order` | `INTEGER` | `NULL` | `1` | Added in migration 5 |

### 3.8 `session_sets`
Granular set-by-set performance log under a `session_exercises` record.

| Column | Type | Nullable | Default | Constraints & Foreign Keys |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `UUID` | `NOT NULL` | `uuid_generate_v4()` | `PRIMARY KEY` |
| `session_exercise_id` | `UUID` | `NULL` | — | `REFERENCES session_exercises(id) ON DELETE CASCADE`, `UNIQUE (session_exercise_id, set_number)` |
| `set_number` | `INTEGER` | `NOT NULL` | — | `1`-based set index; `UNIQUE (session_exercise_id, set_number)` |
| `weight` | `DECIMAL(6,2)` | `NULL` | — | Persisted as `parseFloat(s.weight) \|\| 0` (`0` for bodyweight or blank) |
| `reps` | `INTEGER` | `NULL` | — | Persisted as `parseInt(s.reps, 10) \|\| 0` |
| `is_completed` | `BOOLEAN` | `NOT NULL` | `FALSE` | Only `TRUE` sets count toward volume, PRs, and analytics |
| `created_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Used by Routine Builder to look up most recent completed weight |
| `updated_at` | `TIMESTAMPTZ` | `NULL` | `NOW()` | Timestamp |

---

## 4. Indexes & Row-Level Security (RLS) Summary

### Explicit & Unique Indexes
Beyond primary keys, PostgreSQL maintains **9 secondary/unique indexes**:
1. `routine_days_routine_id_day_number_key` — `UNIQUE (routine_id, day_number)` on `routine_days`
2. `routine_exercises_routine_day_id_order_index_key` — `UNIQUE (routine_day_id, order_index)` on `routine_exercises`
3. `sessions_routine_id_routine_day_id_cycle_number_key` — `UNIQUE (routine_id, routine_day_id, cycle_number)` on `sessions`
4. `session_sets_session_exercise_id_set_number_key` — `UNIQUE (session_exercise_id, set_number)` on `session_sets`
5. `idx_sessions_user_started` — `INDEX (user_id, started_at DESC)` on `sessions` (migration 4)
6. `idx_routine_exercises_superset` — `INDEX (routine_day_id, superset_id)` on `routine_exercises` (migration 5)
7. `idx_session_exercises_superset` — `INDEX (session_id, superset_id)` on `session_exercises` (migration 5)
8. `idx_sessions_routine_day_id` — `INDEX (routine_day_id)` on `sessions` (migration 7)
9. `idx_session_exercises_routine_exercise_id` — `INDEX (routine_exercise_id)` on `session_exercises` (migration 7)

### Row-Level Security & Role Grants (Post-Phase 1 Hardening)
- **`anon` role:** `USAGE` on `public` schema and all table privileges **revoked**. Unauthenticated requests cannot read or mutate any table.
- **`authenticated` role:** Explicit `SELECT, INSERT, UPDATE, DELETE` granted on the 8 public tables (`ALTER DEFAULT PRIVILEGES` revoked so future tables are not auto-exposed).
- **Ownership Policies:**
  - `exercises` & `exercise_muscle_groups`: `SELECT` permitted when `user_id = auth.uid()` **or** `user_id = '00000000-0000-0000-0000-000000000000'` (system seed library). `INSERT`, `UPDATE`, and `DELETE` strictly require `user_id = auth.uid()` (system library rows are immutable).
  - `routines`: `FOR ALL` requires `auth.uid() = user_id` (`USING` and `WITH CHECK`).
  - `sessions`: Re-asserted in migration 7 (`TO authenticated`) strictly via `(select auth.uid()) = user_id`, ensuring orphaned sessions with `routine_id IS NULL` or `routine_day_id IS NULL` stay readable and isolated by owner.
  - `routine_days`, `routine_exercises`, `session_exercises`, `session_sets`: `FOR ALL` verified via `EXISTS (...)` subquery joining back to parent `routines.user_id` or `sessions.user_id = (select auth.uid())`.

---

## 5. Entity-Relationship Diagram

```mermaid
erDiagram
    AUTH_USERS ||--o{ EXERCISES : "owns"
    AUTH_USERS ||--o{ ROUTINES : "owns"
    AUTH_USERS ||--o{ SESSIONS : "logs"

    EXERCISES ||--|{ EXERCISE_MUSCLE_GROUPS : "maps fractional volume"
    EXERCISES ||--o{ ROUTINE_EXERCISES : "prescribed in (RESTRICT)"
    EXERCISES ||--o{ SESSION_EXERCISES : "performed in (CASCADE)"

    ROUTINES ||--|{ ROUTINE_DAYS : "splits into (CASCADE)"
    ROUTINES |o--o{ SESSIONS : "rotates through (SET NULL)"

    ROUTINE_DAYS ||--o{ ROUTINE_EXERCISES : "orders (CASCADE)"
    ROUTINE_DAYS |o--o{ SESSIONS : "instantiates (SET NULL)"

    ROUTINE_EXERCISES |o--o{ SESSION_EXERCISES : "optional ref (SET NULL)"

    SESSIONS ||--|{ SESSION_EXERCISES : "contains (CASCADE)"
    SESSION_EXERCISES ||--|{ SESSION_SETS : "records sets (CASCADE)"

    EXERCISES {
        uuid id PK
        uuid user_id FK
        text name
        boolean is_bodyweight_only
        int default_rest_timer_seconds
        timestamptz created_at
        timestamptz updated_at
    }

    EXERCISE_MUSCLE_GROUPS {
        uuid exercise_id PK,FK
        muscle_group muscle_group PK
        decimal fraction "0.5 or 1.0"
    }

    ROUTINES {
        uuid id PK
        uuid user_id FK
        text name
        routine_status status "draft|active|completed"
        int days_in_split "3..7"
        int cycles_per_routine ">=1"
        int current_day
        int current_cycle
        timestamptz created_at
        timestamptz updated_at
    }

    ROUTINE_DAYS {
        uuid id PK
        uuid routine_id FK
        int day_number "UNIQUE(routine_id, day_number)"
        text name "nullable custom label"
    }

    ROUTINE_EXERCISES {
        uuid id PK
        uuid routine_day_id FK
        uuid exercise_id FK
        int order_index "UNIQUE(routine_day_id, order_index)"
        int planned_sets ">=1"
        decimal target_weight
        int target_reps
        text superset_id
        int superset_order
    }

    SESSIONS {
        uuid id PK
        uuid user_id FK
        uuid routine_id FK
        uuid routine_day_id FK
        int cycle_number "UNIQUE(routine, day, cycle)"
        session_status status "in_progress|completed"
        int duration_seconds
        timestamptz started_at
        timestamptz completed_at
    }

    SESSION_EXERCISES {
        uuid id PK
        uuid session_id FK
        uuid routine_exercise_id FK
        uuid exercise_id FK
        decimal next_target_weight
        int next_target_reps
        text superset_id
        int superset_order
    }

    SESSION_SETS {
        uuid id PK
        uuid session_exercise_id FK
        int set_number "UNIQUE(session_exercise_id, set_number)"
        decimal weight
        int reps
        boolean is_completed
        timestamptz created_at
        timestamptz updated_at
    }
```

---

## 6. Migration History, Seed Library & Import/Export Capabilities

### Migration Timeline (`supabase/migrations/`)
1. `20260713165135_initial_schema.sql` — Enables `uuid-ossp`; creates 3 enums and all 8 base tables.
2. `20260724075500_add_rls_policies.sql` — Enables RLS on all 8 tables; adds initial ownership policies and broad `anon`/`authenticated` grants.
3. `20260728103000_phase1_security_hardening.sql` — Makes system exercises (`00000000-0000-0000-0000-000000000000`) read-only, tightens `exercise_muscle_groups` write policies to owned exercises, revokes `anon` schema/table access, and applies explicit least-privilege grants to `authenticated`.
4. `20260728110000_phase2_session_persistence.sql` — Adds `sessions.duration_seconds` (`INTEGER`) and `idx_sessions_user_started`.
5. `20260818000000_add_superset_support.sql` — Adds `superset_id` and `superset_order` to `routine_exercises` and `session_exercises` plus lookup indexes. *(Note: `routine-builder/new.tsx` and `workout/complete.tsx` include runtime fallback catch blocks that retry inserts without `superset_id`/`superset_order` if a remote PostgREST schema cache lags behind migration 5).*
6. `20260820000000_add_core_muscle_group.sql` — Appends `'Core'` to `public.muscle_group` enum.
7. `20261113000000_data_safety_and_day_names.sql` — Converts `sessions.routine_id`, `sessions.routine_day_id`, and `session_exercises.routine_exercise_id` foreign keys from `ON DELETE CASCADE` to `ON DELETE SET NULL`; adds `idx_sessions_routine_day_id` & `idx_session_exercises_routine_exercise_id`; re-asserts `sessions`, `session_exercises`, and `session_sets` RLS strictly via `sessions.user_id = (select auth.uid())`; adds `routine_days.name TEXT`.

### Client-Side Persisted Store Schema (`AsyncStorage` via Zustand)
- **`useActiveWorkoutStore` (`weightlifting-active-workout-v1`, `src/store/useActiveWorkoutStore.ts`):** Persists `draft: ActiveWorkoutDraft | null` (`userId`, `routineId`, `routineName`, `routineDayId`, `dayNumber`, `dayName`, `cycleNumber`, `daysInSplit`, `cyclesPerRoutine`, `startedAtTimestamp`, `durationSeconds`, `workoutExercises`, `restTimerEndTimestamp`, `restTimerTotalSeconds`, `syncStatus: 'in_progress' | 'pending_sync'`, `savedSessionId`) alongside an in-memory `_hasHydrated` boolean.
- **`usePreferencesStore` (`weightlifting-preferences-v1`, `src/store/usePreferencesStore.ts`):** Persists `defaultRestSeconds: 60 | 90 | 120 | 180` (default `90`) and `hapticsEnabled: boolean` (default `true`) alongside `_hasHydrated`.

### Built-In Seed Data (`supabase/seed.sql`)
Inserts **1 system user** (`00000000-0000-0000-0000-000000000000`, `system@weightlog.local`), **12 global exercises**, and **20 muscle-group fractional rows** (note: **0** seeded exercises currently map to `'Core'`):

| UUID Suffix | Exercise Name | Bodyweight Only | Rest Timer | Primary (`1.0`) | Secondary (`0.5`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `...0001` | Barbell Bench Press | `false` | `120s` | Chest | Shoulders, Triceps |
| `...0002` | Incline Dumbbell Press | `false` | `90s` | Chest | Shoulders |
| `...0003` | Barbell Back Squat | `false` | `180s` | Legs | — |
| `...0004` | Romanian Deadlift | `false` | `120s` | Legs | Back |
| `...0005` | Pull-Up | `true` | `90s` | Back | Biceps |
| `...0006` | Barbell Bent Over Row | `false` | `90s` | Back | Biceps |
| `...0007` | Overhead Dumbbell Press | `false` | `90s` | Shoulders | Triceps |
| `...0008` | Lateral Dumbbell Raise | `false` | `60s` | Shoulders | — |
| `...0009` | Barbell Bicep Curl | `false` | `60s` | Biceps | — |
| `...0010` | Tricep Rope Pushdown | `false` | `60s` | Triceps | — |
| `...0011` | Dips | `true` | `90s` | Triceps | Chest |
| `...0012` | Leg Extension | `false` | `60s` | Legs | — |

### Data Import, Export & Backup Capabilities
- **CSV Export (Web-Only, Partial Schema):** `app/analytics/index.tsx` (`handleExportCSV`) exports flat set rows (`Date,Routine,Cycle,Exercise,Set,Weight(lbs),Reps,Completed,Estimated1RM(lbs)`) using `calculateEstimated1RM` via DOM `Blob` download **only when `Platform.OS === 'web'`**. On iOS and Android, tapping **Export CSV** is a silent no-op (`expo-file-system` / `expo-sharing` are not installed). Routines, split structures, custom exercises, and muscle mappings are not exported.
- **Data Import / Restore:** **None.** No CSV, JSON, Strong/Hevy import, or backup/restore mechanism exists.
- **Cascade Deletion Mitigation:** Fixed in migration 7 (`20261113000000_data_safety_and_day_names.sql`): `sessions.routine_id`, `sessions.routine_day_id`, and `session_exercises.routine_exercise_id` use `ON DELETE SET NULL`, so deleting a routine or split day preserves all historical sessions, sets, and PRs under `sessions.user_id`.
