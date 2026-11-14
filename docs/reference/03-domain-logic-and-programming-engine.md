> **Reference Pack Metadata**
> - **App Name:** Best Damn Weight Lifting Tracker Ever (`weightliftinglog` / UI Banner: *Best Damn Workout Tracker Ever*)
> - **Git Commit SHA & Branch:** `9a6f80e` (`main`) + Phase 1 Working Tree Updates — Base Commit `2026-09-30 18:54:32 -0500`
> - **Snapshot Date:** `2026-11-13`
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
- **Split Dimensions:** `routines.days_in_split` supports **3 to 7 days** (`CHECK (days_in_split BETWEEN 3 AND 7)`). Users cannot create 1-day or 2-day full-body splits.
- **Mesocycle / Block Length:** `routines.cycles_per_routine` (`CHECK (cycles_per_routine >= 1)`) offers UI presets of **2, 3, 4, or 6 cycles** in Routine Builder Step 1.
- **Horizontal Cycle Rotation Engine:** Progression is an asynchronous sequential queue tracked by `(current_day, current_cycle)` on `routines` rather than fixed calendar days:
  - Completing Day $d < \text{days\_in\_split}$ sets $\text{nextDay} = d + 1$, $\text{nextCycle} = c$.
  - Completing Day $d = \text{days\_in\_split}$ wraps $\text{nextDay} = 1$, $\text{nextCycle} = c + 1$.
  - **Missing Lifecycle Cap:** `app/workout/complete.tsx` never checks whether `nextCycle > cycles_per_routine`, never transitions `routines.status` to `'completed'`, and has no `"Clone & Repeat"` flow (despite `requirements.md` §6).

### Exercise Ordering, Supersets & Giant Sets
- **Ordering:** `routine_exercises.order_index` (`1..N`, `UNIQUE (routine_day_id, order_index)`) defines vertical sequence within a split day. Routine Builder supports adding/removing exercises and linking adjacent items, **but lacks up/down drag or reorder buttons** once added.
- **Supersets / Giant Sets / Circuits:** Fully supported across planning (`routine-builder/new.tsx`), execution (`workout/active.tsx`), and history (`history/[id].tsx`):
  - Grouped by shared string `superset_id` (`ss_<timestamp>_<random4>`) and ordered by `superset_order` (`1..K`).
  - Labeled alphabetically per day (`SUPERSET A` -> `A1`, `A2`, `A3`; `SUPERSET B` -> `B1`, `B2`). Supports 2-exercise supersets as well as 3+ exercise giant sets/circuits.
  - Unlinking or deleting exercises automatically re-indexes `superset_order`; if only 1 exercise remains in a `superset_id`, it auto-dissolves back to standalone (`superset_id = null, superset_order = 1`).
  - **Superset Muscle Synergy Classifier (`getSupersetSynergy` in `routine-builder/new.tsx`):** Evaluates primary (`fraction >= 1.0`) muscles across grouped exercises:
    - Duplicate primary muscle -> `'competing'` (*"Competing Muscles"*, amber badge).
    - `Chest + Back` or `Biceps + Triceps` -> `'antagonist'` (*"Antagonist Synergy"*, emerald badge; note: `isLegsUpper` is computed on line 37 of `new.tsx` but unused in the `if` condition!).
    - Any other distinct primaries -> `'non_competing'` (*"Non-Competing Pair"*, teal badge).

### Set Types
- **Schema & Persistence:** **Working sets only.** `session_sets` has no `set_type` column. Every completed set counts identically toward tonnage, e1RM, PRs, and hypertrophy set volume.
- **UI Stub:** `src/components/SetRow.tsx` declares `setStyle?: 'normal' | 'warmup' | 'drop' | 'failure'` in `SetRowProps` (default `'normal'`), **but never reads or renders it**. Warm-up, top/back-off, drop, MYO/rest-pause, AMRAP, and power/speed sets are unimplemented.

---

## 3. Prescription & Logging Fields

| Field / Concept | Status | Ground-Truth Behavior |
| :--- | :--- | :--- |
| **Weight / Load Units** | **Hardcoded `lbs` (UI) / `kg` (Unused Util)** | All UI labels, placeholders, charts, and CSV headers hardcode **`lbs`**. No `kg`/`lbs` user preference or unit conversion exists. Ironically, unused `calculateNextLoadAndReps` in `src/utils/autoRegEngine.ts` returns `weightKg` with `minIncrement = 2.5`. |
| **Bodyweight Load** | **Partial** | `exercises.is_bodyweight_only` hides `Target (lbs)` in Routine Builder and replaces the weight input with `"BW"` inside **Superset** active rows, saving `weight = 0`. However, **Standalone** active cards (`SetRow`) still render an editable `"LBS"` input (`'0'`) and `"Next Target Weight (lbs)"`. Weighted calisthenics (`BW + added load`) and assisted bodyweight are unsupported. |
| **Reps & Rep Ranges** | **Single Integer Only** | `routine_exercises.target_reps` and `session_sets.reps` are single integers (default `10`). Rep ranges (e.g., `8–12`) are not supported. |
| **%1RM Prescriptions** | **Missing** | Exercises cannot be prescribed as a percentage of e1RM or training max. |
| **RPE / RIR / Failure Flags** | **Read-Only Cycle Badge Only** | Dashboard shows a cycle-level RIR badge (`Target: X RIR (Cycle Y)`) from `getTargetRIR(current_cycle)`. Neither `/workout/active` nor `session_sets` can record per-set RPE, RIR, or failure flags. |
| **Tempo / ROM / Coaching Notes** | **Missing** | Zero free-text notes columns exist on `exercises`, `routines`, `routine_exercises`, `sessions`, or `session_sets`. No tempo (e.g., `3-1-1-0`) or ROM fields exist. |
| **Rest Timers** | **Implemented (Per-Exercise, Wall-Clock Safe)** | `exercises.default_rest_timer_seconds` (new exercises and fallback defaults read from persisted `usePreferencesStore.defaultRestSeconds`: `60 \| 90 \| 120 \| 180`, default `90s`). Completing a standalone set starts a background-safe wall-clock countdown (`Math.max(0, Math.ceil((restTimerEndTimestamp - Date.now()) / 1000))`) reconciled via `AppState`. Completing a set inside a **Superset** cancels any active timer mid-round and only starts `Math.max(...supersetGroup.default_rest_timer_seconds)` once **every exercise in that round (`setIdx`) is completed**. Overlay `+30s` and `Skip` update the persisted `restTimerEndTimestamp`, and haptics obey `usePreferencesStore.hapticsEnabled`. |

---

## 4. Mathematical Formulas & Progression Logic

### 4.1 Estimated 1-Rep Max (e1RM)
1. **Primary Epley Formula (`calculateEstimated1RM` in `src/utils/analyticsEngine.ts`):** Used uniformly across Dashboard, Active Workout live badge, History, Session Detail, Cycle Comparison, Performance Hub charts, and CSV export (`handleExportCSV`):
   $$\text{e1RM}(w, r) = \begin{cases} 0 & \text{if } w \le 0 \text{ or } r \le 0 \\ \text{round}_{0.1}(w) & \text{if } r = 1 \\ \text{round}_{0.1}\!\left(w \times \left(1 + \frac{\min(r, 15)}{30}\right)\right) & \text{if } r > 1 \end{cases}$$
   *Reps above 15 are capped at `15` (`effectiveReps = Math.min(reps, 15)`, max multiplier `1.5x`) to prevent high-rep endurance sets from inflating 1RM.*
2. **Brzycki Formula (`calculateBrzycki1RM` in `src/utils/analyticsEngine.ts` — Unused in UI):**
   $$\text{e1RM}_{\text{Brzycki}}(w, r) = \begin{cases} 0 & \text{if } w \le 0 \text{ or } r \le 0 \\ w & \text{if } r \ge 37 \\ \text{round}_{0.1}\!\left(w \times \frac{36}{37 - r}\right) & \text{if } 1 \le r < 37 \end{cases}$$

### 4.2 Volume Load (Tonnage) & Training Density
- **Session / Weekly / Lifetime Tonnage:** Summed strictly over completed sets (`is_completed === true`):
  $$\text{Tonnage} = \text{round}\!\left(\sum_{s \in \text{completed}} w_s \times r_s\right) \quad [\text{lbs}]$$
  *(Bodyweight-only sets store `w = 0`, contributing `0 lbs` to tonnage).*
- **Training Density (`lbs/min`):**
  $$\text{durationMinutes} = \max\!\left(\text{round}\!\left(\frac{\text{durationSeconds}}{60}\right), 1\right), \qquad \text{Density} = \text{round}\!\left(\frac{\text{Tonnage}}{\text{durationMinutes}}\right)$$
  *Fallback hierarchy when `sessions.duration_seconds` is null/0:* `Math.round((completed_at - started_at) / 1000)`, else hardcoded `1800` seconds (`30 min`).

### 4.3 Fractional Muscle Group Set Volume & Hypertrophy Thresholds
- **Planned Split Volume** (`dashboardMetrics.ts` & `routine-builder/new.tsx` Step 3):
  $$\text{TargetSets}(m) = \sum_{d=1}^{\text{days\_in\_split}} \sum_{e \in d} \text{planned\_sets}_e \times \text{fraction}_{e,m}$$
- **Completed Weekly Volume** (`dashboardMetrics.ts` & `getWeeklyVolumeHistory` in `analyticsEngine.ts`, anchored Monday `00:00:00` local time):
  $$\text{CompletedSets}(m) = \sum_{s \in \text{weekSessions}} \sum_{e \in s} \left(\text{count}(\text{completed sets in } e) \times \text{fraction}_{e,m}\right)$$
- **Hypertrophy Landmark Classification (`evaluateHypertrophyVolume` & `getMuscleGroupVolumeStatusList`):**
  - `weeklySets == 0` -> `'low'` — `"No Stimulus"` (`#f59e0b` amber)
  - `0 < weeklySets < 6` -> `'low'` — `"Sub-Optimal (<6s)"` (`#f59e0b` amber; below MEV)
  - `6 <= weeklySets <= 20` -> `'optimal'` — `"Optimal Volume (MAV)"` (`#10b981` emerald; spans MEV `6–12` + MAV `12–20`)
  - `weeklySets > 20` -> `'high'` — `"High Fatigue (>20s)"` (`#ef4444` red; exceeds MRV)
  - *(Note: `AnalyticsScreen` RadarChart hardcodes `target: 14` sets/week per muscle group rather than reading the active routine's `TargetSets(m)`).*

### 4.4 Personal Record (PR) Detection (Two Divergent Implementations)
1. **Analytics Engine (`extractPersonalRecords` in `src/utils/analyticsEngine.ts`):** Chronologically scans all sessions per `exercise_id` and records multi-vector all-time peaks:
   - `maxWeight` and `maxRepsAtMaxWeight` (updates on `w > maxWeight`, or `w === maxWeight && r > maxRepsAtMaxWeight`).
   - `maxVolumeSingleSet = max(w * r)`.
   - `estimated1RM = max(calculateEstimated1RM(w, r))`.
   - Includes an exercise's very first session and includes bodyweight exercises (`maxRepsAtMaxWeight > 0`).
2. **Dashboard Recent Logs Trophy (`computeDashboardStats` in `src/utils/dashboardMetrics.ts`):** Flags `prSessionIds` **only** when a session achieves `sessionMaxWeight > prevMaxWeight` **and** `prevMaxWeight > 0`. First-time exercise sessions, rep PRs at an existing max weight, e1RM PRs at sub-maximal weight, and bodyweight exercises never earn a PR badge on Dashboard cards.

### 4.5 Progressive Overload ("Fresh Memory" Targeting — Live) vs. Algorithmic Autoregulation (Stubbed)
- **Live Progression Loop (`workout/active.tsx` + `workout/complete.tsx`):**
  1. **Pre-fill Priority on Workout Start:** Queries all completed `session_exercises` for the day's exercises, sorted by `completed_at DESC`. Resolves `baseWeight` via:
     `history.next_target_weight` -> `lastCompletedSet.weight` -> `maxCompletedSet.weight` -> `firstCompletedSet.weight` -> `routine_exercises.target_weight` -> `'135'` (`'0'` if bodyweight). Set `i` reps pre-fill from `history.completedSets[i - 1].reps`, else `next_target_reps ?? lastSet.reps ?? firstSet.reps ?? target_reps ?? '10'`.
  2. **In-Session Auto-Promotion:** Completing a set or editing Set 1 automatically updates `next_target_weight` to `Math.max(...completedWeights)` unless the user manually edits the **Next Target Weight** input (`is_target_weight_manually_edited = true`).
  3. **Completion Sync:** `workout/complete.tsx` saves `next_target_weight` onto `session_exercises` **and** overwrites `routine_exercises.target_weight` on both the current `routine_exercise_id` and any other split days in the same routine containing that `exercise_id`.
- **Autoregulation & Deload Engine (`src/utils/autoRegEngine.ts` + `MuscleFeedbackModal.tsx`):**
  - **Partially Wired — `getTargetRIR(weekIndex)`:** Called **only** on Dashboard (`getTargetRIR(activeRoutine.current_cycle)`):
    - Cycle `1` -> `3 RIR` | Cycle `2` -> `2 RIR` | Cycle `3` -> `1 RIR` | Cycle `4` -> `0 RIR` | Cycle `5` -> `3 RIR` (commented as Deload, though volume/load are not reduced) | Cycle `>= 6` -> `3 RIR` (default fallback!).
  - **Dead / Unwired — `calculateNextLoadAndReps(w, r, minInc = 2.5)`:** Computes `nextWeight = w * 1.03`; if `nextWeight - w < minInc`, keeps `w` and returns `r + 1`, else rounds `nextWeight` to nearest `2.5`. **Never imported anywhere.**
  - **Dead / Unwired — `calculateVolumeDelta(pump, soreness, workload, jointIntegrityFlag)` & `MuscleFeedbackModal.tsx`:** Implements RP-style autoregulation (`jointIntegrityFlag === 1` -> `0` sets; `soreness === 3 && workload === 3` -> `-2` sets; either `=== 3` -> `-1` set; `soreness === 1 && workload === 1 && pump <= 2` -> `+1` set; else `0`). **Never imported or persisted anywhere.**
