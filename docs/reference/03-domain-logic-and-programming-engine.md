> **Reference Pack Metadata**
> - **App Name:** Best Damn Weight Lifting Tracker Ever (`weightliftinglog` / UI Banner: *Best Damn Workout Tracker Ever*)
> - **Git Commit SHA & Branch:** `9a6f80e` (`main`) + Phase 1 & Phase 2 Working Tree Updates — Base Commit `2026-09-30 18:54:32 -0500`
> - **Snapshot Date:** `2026-11-14`
> - **File Scope:** Weightlifting domain taxonomy, program/split/superset modeling, prescription & set-logging capabilities, and exact mathematical formulas for e1RM, fractional hypertrophy volume, tonnage, density, PR detection, progressive overload, and autoregulation.

# 03 — Domain Logic & Programming Engine

## 1. Exercise Taxonomy & Muscle Mapping

| Domain Concept | Status | Exact Implementation vs. Missing / Hardcoded Behavior |
| :--- | :--- | :--- |
| **Muscle Groups** | **Implemented (7 Fixed)** | Backed by PostgreSQL enum `muscle_group` and TS tuple `MUSCLE_GROUPS`: `'Chest'`, `'Back'`, `'Shoulders'`, `'Legs'`, `'Biceps'`, `'Triceps'`, `'Core'`. Coarse-grained (e.g., Quads, Hamstrings, Glutes, and Calves are all collapsed into `'Legs'`; Front/Side/Rear Delts into `'Shoulders'`; Upper Back/Lats into `'Back'`). |
| **Primary vs. Secondary Weighting** | **Implemented (Fractional)** | Stored in `exercise_muscle_groups.fraction` (`CHECK (fraction IN (0.5, 1.0))`). Both `app/exercises/[id].tsx` and inline creation in `app/routine-builder/new.tsx` enforce **exactly 1 primary muscle (`1.0`)** and **0..6 optional secondary muscles (`0.5` each)**, preventing the primary muscle from also being selected as secondary. |
| **Equipment Types** | **Binary Flag Only** | Only `is_bodyweight_only: boolean` exists on `exercises`. There is **no** equipment enum (Barbell, Dumbbell, Cable, Machine, Kettlebell, Smith Machine, Bands); equipment names exist purely as unstructured substrings in `exercises.name`. |
| **Movement Patterns** | **Missing** | No horizontal/vertical push/pull, squat, hinge, lunge, carry, or isolation/compound classification exists in DB or TS types. |
| **Unilateral vs. Bilateral** | **Missing** | No unilateral flag or per-limb multiplier (`2x` tonnage/set handling for single-arm/single-leg Dumbbell/Cable work). |

---

## 2. Planning, Splits, Supersets & Set Types

### Workouts, Splits & Mesocycles
- **Split Dimensions:** `routines.days_in_split` supports **2 to 7 days** (`CHECK (days_in_split BETWEEN 2 AND 7)` in migration 8), unlocking 2-day full-body superset splits alongside 3–7 day routines. True Edit Split (`routineId` param) preserves surviving `routine_days.id` UUIDs via upsert on `(routine_id, day_number)` and clamps `current_day` when shortening a split.
- **Mesocycle / Block Length:** `routines.cycles_per_routine` (`CHECK (cycles_per_routine >= 1)`) offers UI presets of **2, 3, 4, or 6 cycles** in Routine Builder Step 1.
- **Horizontal Cycle Rotation Engine:** Progression is an asynchronous sequential queue tracked by `(current_day, current_cycle)` on `routines` rather than fixed calendar days:
  - Completing Day $d < \text{days\_in\_split}$ sets $\text{nextDay} = d + 1$, $\text{nextCycle} = c$.
  - Completing Day $d = \text{days\_in\_split}$ wraps $\text{nextDay} = 1$, $\text{nextCycle} = c + 1$.
  - **Missing Lifecycle Cap:** `app/workout/complete.tsx` never checks whether `nextCycle > cycles_per_routine`, never transitions `routines.status` to `'completed'`, and has no `"Clone & Repeat"` flow (despite `requirements.md` §6).

### Exercise Ordering, Supersets, Giant Sets & Coaching Guardrails
- **Ordering:** `routine_exercises.order_index` (`1..N`, `UNIQUE (routine_day_id, order_index)`) defines vertical sequence within a split day. Routine Builder Step 2 provides **Up / Down** controls both for top-level blocks (standalone lifts and whole superset blocks) and for individual slots (`A1 ↔ A2`) within a superset, auto-reindexing `order_index` and `superset_order`.
- **Supersets / Giant Sets / Circuits:** Fully supported across planning (`routine-builder/new.tsx`), execution (`workout/active.tsx`), and history (`history/[id].tsx`):
  - Grouped by shared string `superset_id` (`ss_<timestamp>_<random4>`) and ordered by `superset_order` (`1..K`).
  - Labeled alphabetically per day (`SUPERSET A` -> `A1`, `A2`, `A3`; `SUPERSET B` -> `B1`, `B2`). Supports 2-exercise supersets as well as 3+ exercise giant sets/circuits.
  - Unlinking or deleting exercises automatically re-indexes `superset_order`; if only 1 exercise remains in a `superset_id`, it auto-dissolves back to standalone (`superset_id = null, superset_order = 1`).
  - **Superset Muscle Synergy Classifier (`getSupersetSynergy` in `src/utils/supersetSynergy.ts`):** Evaluates both `1.0` primary and `0.5` secondary muscle fractions strictly within the 7-value `MuscleGroup` union:
    1. Duplicate primary (`1.0`) -> `'competing'` (*"Competing Primaries"*, rose badge).
    2. Primary (`1.0`) overlaps another lift's secondary (`0.5`), or shared secondary (`0.5`) across lifts (e.g., Bench Press + Tricep Pushdown) -> `'synergist_overlap'` (*"Synergist Overlap"*, amber badge).
    3. Distinct upper-body primaries matching `Chest + Back` or `Biceps + Triceps` without overlap -> `'antagonist'` (*"Antagonist Pair"*, emerald badge).
    4. Strictly upper-body primary + lower-body (`'Legs'`) primary -> `'upper_lower'` (*"Upper / Lower Split"*, cyan badge).
    5. Distinct muscles without direct agonist/synergist interference -> `'non_competing'` (*"Non-Competing"*, indigo badge).
  - **Routine Builder Split-Day Guardrails (`evaluateSplitDayGuardrails` in `src/utils/supersetSynergy.ts`):** Non-blocking coaching warnings surfaced in Step 2 when a day schedules `> 2` heavy low-rep lifts (`target_rep_max ?? target_reps <= 6`), orders a heavy low-rep lift after higher-rep work, or exceeds `> 15` fractional planned sets for any muscle group inside a single day.

### Set Types & Warmup Exclusion
- **Schema & Persistence:** `session_sets.set_type` (`'normal' | 'warmup' | 'drop' | 'failure'`, default `'normal'`) persisted via Migration #8 with schema-cache fallback.
- **Tap-to-Cycle UI:** `SetRow.tsx` and superset round rows in `workout/active.tsx` cycle `normal -> warmup (W) -> drop (D) -> failure (F)` on badge tap, and `history/[id].tsx` renders `WARMUP`, `DROP`, and `FAIL` badges.
- **Warmup Exclusion (`isWorkingCompletedSet` in `src/utils/analyticsEngine.ts`):** Warmup sets (`set_type === 'warmup'`) are excluded globally (`Boolean(st?.is_completed && (st?.set_type || 'normal') !== 'warmup')`) from tonnage, working set counts, Epley e1RM, PRs, fractional muscle volume, consistency heatmaps, dashboard KPIs, historical baseline pre-fills, and active-workout cloning/live KPIs (while CSV export includes them with `Estimated1RM = 0` and `SetType = 'warmup'`). Rest-pause / MYO / AMRAP remain unimplemented.

---

## 3. Prescription & Logging Fields

| Field / Concept | Status | Ground-Truth Behavior |
| :--- | :--- | :--- |
| **Weight / Load Units** | **Hardcoded `lbs` (UI) / `kg` (Unused Util)** | All UI labels, placeholders, charts, and CSV headers hardcode **`lbs`**. No `kg`/`lbs` user preference or unit conversion exists. Ironically, unused `calculateNextLoadAndReps` in `src/utils/autoRegEngine.ts` returns `weightKg` with `minIncrement = 2.5`. |
| **Bodyweight Load** | **Full Overload Parity (BW Only)** | `exercises.is_bodyweight_only` hides `Target (lbs)` in Routine Builder, displays a uniform **`BW`** badge in both standalone (`SetRow.tsx`) and superset active rows (`weight = 0`), captures **"Next Target Reps"** (`next_target_reps`), writes back `target_reps` / `target_rep_min` / `target_rep_max` to `routine_exercises`, and renders `"BW"` in `history/[id].tsx`. Weighted calisthenics (`BW + added load`) and assisted bodyweight remain unsupported. |
| **Reps & Rep Ranges** | **Min–Max Ranges Supported** | `routine_exercises.target_rep_min` and `target_rep_max` (clamped `min <= max`, backfilled from `target_reps`) are editable in Routine Builder (`Rep Min` / `Rep Max`), shown on active lift cards, and fall back gracefully to `target_reps` if DB lags. |
| **%1RM Prescriptions** | **Missing** | Exercises cannot be prescribed as a percentage of e1RM or training max. |
| **RPE / RIR / Failure Flags** | **Cycle Target + Per-Set RIR** | Header/Dashboard show `getTargetRIR(cycleNumber)` (`0–3 RIR`); standalone (`SetRow.tsx`) and superset rows capture tap-to-cycle `RIR` (`—`, `0`, `1`, `2`, `3`, `4+`) persisted to `session_sets.rir` and shown in `history/[id].tsx` + CSV export. Failure intensity is tagged via `set_type = 'failure'`. |
| **Tempo / ROM / Coaching Notes** | **Missing** | Zero free-text notes columns exist on `exercises`, `routines`, `routine_exercises`, `sessions`, or `session_sets`. No tempo (e.g., `3-1-1-0`) or ROM fields exist. |
| **Rest & Superset Transition Timers** | **Implemented (Wall-Clock + Transition Breather)** | `exercises.default_rest_timer_seconds` (defaults from persisted `usePreferencesStore.defaultRestSeconds`: `60 \| 90 \| 120 \| 180`, default `90s`). Completing a standalone set starts a background-safe wall-clock countdown (`"Rest Timer"`). Inside a **Superset**, completing any non-final exercise of a round either cancels the timer when `supersetTransitionSeconds === 0` (default) or starts a cyan **`"Transition • Next Lift"`** breather countdown (`15 \| 30 \| 45s` from `usePreferencesStore.supersetTransitionSeconds`); completing all exercises in that round always starts full recovery rest (`Math.max(...default_rest_timer_seconds)`). Overlay `+30s` / `Skip` preserve `restTimerLabel`, and `AppState` reconciles timer state across background/lock transitions. |

---

## 4. Mathematical Formulas & Progression Logic

### 4.1 Estimated 1-Rep Max (e1RM)
1. **Primary Epley Formula (`calculateEstimated1RM` in `src/utils/analyticsEngine.ts`):** Used uniformly across Dashboard, Active Workout live badge, History, Session Detail, Cycle Comparison, Performance Hub charts, and CSV export (`handleExportCSV`, returning `0` when `set_type === 'warmup'`):
   $$\text{e1RM}(w, r) = \begin{cases} 0 & \text{if } w \le 0 \text{ or } r \le 0 \\ \text{round}_{0.1}(w) & \text{if } r = 1 \\ \text{round}_{0.1}\!\left(w \times \left(1 + \frac{\min(r, 15)}{30}\right)\right) & \text{if } r > 1 \end{cases}$$
   *Reps above 15 are capped at `15` (`effectiveReps = Math.min(reps, 15)`, max multiplier `1.5x`) to prevent high-rep endurance sets from inflating 1RM.*
2. **Brzycki Formula (`calculateBrzycki1RM` in `src/utils/analyticsEngine.ts` — Unused in UI):**
   $$\text{e1RM}_{\text{Brzycki}}(w, r) = \begin{cases} 0 & \text{if } w \le 0 \text{ or } r \le 0 \\ w & \text{if } r \ge 37 \\ \text{round}_{0.1}\!\left(w \times \frac{36}{37 - r}\right) & \text{if } 1 \le r < 37 \end{cases}$$

### 4.2 Volume Load (Tonnage) & Training Density
- **Session / Weekly / Lifetime Tonnage:** Summed strictly over working completed sets (`isWorkingCompletedSet(s)` — i.e., `is_completed === true` and `(set_type || 'normal') !== 'warmup'`):
  $$\text{Tonnage} = \text{round}\!\left(\sum_{s \in \text{workingCompleted}} w_s \times r_s\right) \quad [\text{lbs}]$$
  *(Bodyweight-only sets store `w = 0`, contributing `0 lbs` to tonnage).*
- **Training Density (`lbs/min`):**
  $$\text{durationMinutes} = \max\!\left(\text{round}\!\left(\frac{\text{durationSeconds}}{60}\right), 1\right), \qquad \text{Density} = \text{round}\!\left(\frac{\text{Tonnage}}{\text{durationMinutes}}\right)$$
  *Fallback hierarchy when `sessions.duration_seconds` is null/0:* `Math.round((completed_at - started_at) / 1000)`, else hardcoded `1800` seconds (`30 min`).

### 4.3 Fractional Muscle Group Set Volume & ACSM Hypertrophy Thresholds
- **Planned Split Volume** (`dashboardMetrics.ts`, `analytics/index.tsx` RadarChart, & `routine-builder/new.tsx` Step 3):
  $$\text{TargetSets}(m) = \sum_{d=1}^{\text{days\_in\_split}} \sum_{e \in d} \text{planned\_sets}_e \times \text{fraction}_{e,m}$$
- **Completed Weekly Volume** (`dashboardMetrics.ts` & `getWeeklyVolumeHistory` in `analyticsEngine.ts`, anchored Monday `00:00:00` local time):
  $$\text{CompletedSets}(m) = \sum_{s \in \text{weekSessions}} \sum_{e \in s} \left(\text{count}(\text{working completed sets in } e) \times \text{fraction}_{e,m}\right)$$
- **ACSM Hypertrophy Landmark Classification (`evaluateHypertrophyVolume` & `getHypertrophyVolumeMeta`):**
  - `weeklySets <= 0` -> `'none'` — `"No Stimulus (0s)"` (`#64748b` slate)
  - `0 < weeklySets < 6` -> `'low'` — `"Low / Maintenance (<6s)"` (`#f59e0b` amber)
  - `6 <= weeklySets < 10` -> `'moderate'` — `"Moderate (6–9.5s)"` (`#38bdf8` sky)
  - `10 <= weeklySets <= 22` -> `'optimal'` — `"Optimal Hypertrophy (10–22s)"` (`#10b981` emerald)
  - `weeklySets > 22` -> `'high'` — `"High Fatigue (>22s)"` (`#f43f5e` rose)
  - *Analytics Radar Chart (`app/analytics/index.tsx`): plots actual weekly sets against the active routine's planned `TargetSets(m)` (falling back to `12` sets/week baseline when no active routine exists).*

### 4.4 Personal Record (PR) Detection (Two Divergent Implementations)
1. **Analytics Engine (`extractPersonalRecords` in `src/utils/analyticsEngine.ts`):** Chronologically scans all sessions (working sets only via `isWorkingCompletedSet`) per `exercise_id` and records multi-vector all-time peaks:
   - `maxWeight` and `maxRepsAtMaxWeight` (updates on `w > maxWeight`, or `w === maxWeight && r > maxRepsAtMaxWeight`).
   - `maxVolumeSingleSet = max(w * r)`.
   - `estimated1RM = max(calculateEstimated1RM(w, r))`.
   - Includes an exercise's very first session and includes bodyweight exercises (`maxRepsAtMaxWeight > 0`).
2. **Dashboard Recent Logs Trophy (`computeDashboardStats` in `src/utils/dashboardMetrics.ts`):** Flags `prSessionIds` **only** when a session achieves `sessionMaxWeight > prevMaxWeight` (`isWorkingCompletedSet(st) && st.weight > 0`) **and** `prevMaxWeight > 0`. First-time exercise sessions, rep PRs at an existing max weight, e1RM PRs at sub-maximal weight, and bodyweight exercises never earn a PR badge on Dashboard cards.

### 4.5 Progressive Overload ("Fresh Memory" Targeting — Live) vs. Algorithmic Autoregulation (Stubbed)
- **Live Progression Loop (`workout/active.tsx` + `workout/complete.tsx`):**
  1. **Pre-fill Priority on Workout Start & Crowded-Gym Swap:** Queries completed `session_exercises` sorted by `completed_at DESC`, filtering historical `session_sets` through `isWorkingCompletedSet` so warmups never leak into working baselines or `PREVIOUS` ghost text. Weighted lifts resolve `baseWeight` via `next_target_weight -> lastWorkingSet.weight -> maxWorkingWeight -> firstWorkingSet.weight -> routine_exercises.target_weight -> '135'`. Set `i` reps pre-fill from `history.completedSets[i - 1].reps`, else `next_target_reps ?? lastWorkingSet.reps ?? firstWorkingSet.reps ?? target_rep_max ?? target_reps ?? target_rep_min ?? '10'`. Bodyweight exercises resolve `next_target_reps` directly and lock load to `'0'` (`BW`).
  2. **Working-Set Auto-Cloning & Promotion:** Editing the **first working set** (`set_type !== 'warmup'`) clones weight/reps down to subsequent uncompleted **working** sets only — editing a `'warmup'` set never overwrites working sets. Completing a working set updates `next_target_weight` (weighted) or `next_target_reps` (bodyweight) to `Math.max(...)` unless manually overridden.
  3. **Completion Sync (Swap-Safe & Edit-Split-Safe):** Unless `ex.is_swapped` is true, `workout/complete.tsx` saves `next_target_weight` & `next_target_reps` on `session_exercises` and syncs back to `routine_exercises` by `routine_exercise_id` — automatically falling back to `(routine_day_id, exercise_id)` if `routine_exercises` rows were replaced mid-draft by Edit Split (`0` rows affected by ID), and across matching days in the routine. For bodyweight lifts, `target_rep_min` is clamped `<= resolvedTargetReps` to satisfy `routine_exercises_rep_range_check`.
- **Autoregulation & Deload Engine (`src/utils/autoRegEngine.ts` + `MuscleFeedbackModal.tsx`):**
  - **Partially Wired — `getTargetRIR(weekIndex)`:** Called **only** on Dashboard (`getTargetRIR(activeRoutine.current_cycle)`):
    - Cycle `1` -> `3 RIR` | Cycle `2` -> `2 RIR` | Cycle `3` -> `1 RIR` | Cycle `4` -> `0 RIR` | Cycle `5` -> `3 RIR` (commented as Deload, though volume/load are not reduced) | Cycle `>= 6` -> `3 RIR` (default fallback!).
  - **Dead / Unwired — `calculateNextLoadAndReps(w, r, minInc = 2.5)`:** Computes `nextWeight = w * 1.03`; if `nextWeight - w < minInc`, keeps `w` and returns `r + 1`, else rounds `nextWeight` to nearest `2.5`. **Never imported anywhere.**
  - **Dead / Unwired — `calculateVolumeDelta(pump, soreness, workload, jointIntegrityFlag)` & `MuscleFeedbackModal.tsx`:** Implements RP-style autoregulation (`jointIntegrityFlag === 1` -> `0` sets; `soreness === 3 && workload === 3` -> `-2` sets; either `=== 3` -> `-1` set; `soreness === 1 && workload === 1 && pump <= 2` -> `+1` set; else `0`). **Never imported or persisted anywhere.**
