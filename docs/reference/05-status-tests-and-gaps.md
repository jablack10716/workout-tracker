> **Reference Pack Metadata**
> - **App Name:** Best Damn Weight Lifting Tracker Ever (`weightliftinglog` / UI Banner: *Best Damn Workout Tracker Ever*)
> - **Git Commit SHA & Branch:** `9a6f80e` (`main`) + Phase 1 Working Tree Updates — Base Commit `2026-09-30 18:54:32 -0500`
> - **Snapshot Date:** `2026-11-13`
> - **File Scope:** Automated test suite inventory and coverage gaps, feature flags, environment variable catalog (names and purposes only), third-party integrations, Phase 1 resolution status, and a candid Staff Architect audit of remaining bugs, stubbed features, UX friction, scalability bottlenecks, and technical debt.

# 05 — Status, Tests & Gaps

## 1. Test Suite Inventory & Untested Surface Area

| Test Category | Automated Count | Runner / Tooling | Status |
| :--- | :---: | :--- | :--- |
| **Unit Tests** | **0** | None installed | `0` `*.test.*` / `*.spec.*` files in repository |
| **Integration Tests** | **0** | None installed | `0` Supabase / PostgREST / RLS automated tests |
| **End-to-End (E2E) Tests** | **0** | None installed | No Maestro, Detox, Playwright, or Cypress setup |
| **Total Automated Tests** | **0** | No `"test"` script in `package.json` | `npx tsc --noEmit` passes cleanly (`0` errors); `npx expo export -p web` bundles `2,672` modules cleanly |
| **Manual SQL Validation** | **1** *(manual)* | `supabase/snippets/phase1_rls_validation.sql` | 55-line SQL inspection script (not executed in CI; migration 7 unverified against a live Postgres DB on this host) |

### Critical Untested Areas
1. **Pure Domain Math (`src/utils/analyticsEngine.ts`, `dashboardMetrics.ts`, `autoRegEngine.ts`):** Epley 1RM edge cases, fractional set aggregation, Monday week-boundary bucketing, streak calculation across year boundaries, PR multi-vector tie-breaking, and `analyzeCycleProgression` matching lack unit test coverage.
2. **Workout Persistence, Crash Recovery & Retry Idempotency (`src/store/useActiveWorkoutStore.ts`, `app/workout/active.tsx`, `app/workout/complete.tsx`):** AsyncStorage hydration race handling, dead-zone retry recovery (`pending_sync` + `savedSessionId`), and schema-cache fallback branches (`routine_days.name` and `superset_id`) are untested automatically.
3. **Row-Level Security & Migration 7 (`supabase/migrations/`):** Zero automated verification that `anon` is denied, cross-tenant `authenticated` reads/writes are blocked, system-seeded exercises (`00000000-0000-0000-0000-000000000000`) reject mutations, or orphaned sessions (`routine_id IS NULL`) pass live Postgres RLS checks (`supabase` CLI not installed locally).
4. **UI Flows (`app/`):** Routine Builder 3-step state transitions, superset linking/unlinking/round-timer gating, and Set-1-to-Set-N auto-cloning.

---

## 2. Feature Flags, Environment Variables & Third-Party Integrations

### Active Feature Flags
- **Application Feature Flags:** **None** (`0` runtime flags, remote config providers, or feature-toggle modules).
- **Runtime Schema Compatibility Fallbacks:** `app/routine-builder/new.tsx` and `app/workout/complete.tsx` inspect PostgREST errors for missing column / `'schema cache'` responses (`routine_days.name` and `superset_id`) and automatically retry inserts omitting unmigrated columns if connected to an older remote Supabase schema.

### Environment Variables (Names & Purposes Only — No Secrets)

| Variable Name | Source / Scope | Consumed By | Purpose |
| :--- | :--- | :--- | :--- |
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` / `.env.example` (Client-bundled) | `src/lib/supabase.ts` | Base HTTP URL for Supabase Auth & PostgREST API (throws at startup if missing). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` / `.env.example` (Client-bundled) | `src/lib/supabase.ts` | Public Supabase anonymous/publishable JWT used alongside user session JWTs under RLS. |
| `DATABASE_URL` | `.env` / `.env.example` (CLI/Local) | Developer / DB tooling | Direct PostgreSQL connection string (`not` read by Expo client code). |
| `SECRET_KEY`, `ACCESS_KEY`, `REGION` | Local `.env` only (Gitignored) | Local dev tooling | Present as keys in local `.env`; not referenced anywhere in `app/` or `src/`. |
| `OPENAI_API_KEY`, `S3_HOST`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`, `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | `supabase/config.toml` (`env(...)`) | Local Supabase CLI | Optional Supabase Studio AI, experimental S3 storage, and disabled SMS/Apple Auth placeholders. |

### Third-Party Integrations
- **Supabase (Auth + PostgreSQL 17 + PostgREST):** Sole external backend service. Email/password auth only; Apple OAuth, Twilio SMS, Firebase, Auth0, Cognito, Clerk, and Solana Web3 are all `enabled = false` in `supabase/config.toml`.
- **Analytics / Crash Reporting / Push / Payments:** **None** (no Sentry, PostHog, RevenueCat, Stripe, Apple HealthKit, Google Health Connect, or Expo Push Notifications).

---

## 3. Candid Architectural Audit: Phase 1 Resolutions & Remaining Gaps

### 3.1 Phase 1 Resolved Issues (Implemented & Type-Checked)
The following data-safety, gym-floor persistence, and high-priority bugs have been resolved in the current working tree (pending remote execution of migration 7 on live Supabase):
1. **Safe Session History on Routine Deletion (`20261113000000_data_safety_and_day_names.sql`, `app/(tabs)/routines.tsx`):** Converted `sessions.routine_id`, `sessions.routine_day_id`, and `session_exercises.routine_exercise_id` from `ON DELETE CASCADE` to `ON DELETE SET NULL`, indexed nullable FKs, re-asserted `sessions*` RLS via `(select auth.uid())`, and updated the delete confirmation modal copy.
2. **Crash-Safe Active Workout Store & Offline Sync Recovery (`src/store/useActiveWorkoutStore.ts`, `active.tsx`, `complete.tsx`, `tabs/index.tsx`):** Replaced volatile in-memory logging and large URL JSON params with `AsyncStorage`-persisted `useActiveWorkoutStore`, `pending_sync` idempotent recovery (`savedSessionId`), and Dashboard **Resume In-Progress Workout** / **Unsaved Workout Ready to Sync** banners.
3. **Wake-Lock, Background-Safe Rest Timer & Persisted Preferences (`expo-keep-awake`, `src/store/usePreferencesStore.ts`, `settings.tsx`, `SetRow.tsx`, `app.json`):** Added screen wake-lock during workouts, switched timer countdowns to `restTimerEndTimestamp - Date.now()` with `AppState` foreground reconciliation, persisted `defaultRestSeconds` & `hapticsEnabled` in `usePreferencesStore`, and updated `app.json` `"userInterfaceStyle"` to `"dark"`.
4. **Active-Only Routine Deactivation (`routines.tsx`, `routine-builder/new.tsx`):** Deactivation updates filter `.eq('status', 'active')` so `'completed'` routines are preserved.
5. **Custom Split Day Names (`routine_days.name` & `routine-builder/new.tsx`):** Added `name TEXT` to `routine_days` and persisted day titles with PostgREST schema-cache retry fallback.
6. **Cycle Comparison Day Filter & Routine Picker (`analyticsEngine.ts`, `history/compare.tsx`, `history/[id].tsx`):** Fixed `analyzeCycleProgression` to match exact `routine_day_id` / `day_number`, added multi-routine selection on `/history/compare`, and passed `routine_days.day_number` from `/history/[id]`.
7. **System Exercise Immutability UX (`app/exercises/[id].tsx`):** Seeded system exercises render read-only with **Duplicate as Custom Exercise**, hiding Save/Delete and checking `muscleError` / `deleteMuscleError`.
8. **Heatmap Local-Calendar Timezone Fix (`src/components/charts/ConsistencyHeatmap.tsx`):** Buckets `started_at` using local calendar `YYYY-MM-DD` instead of UTC `.toISOString().split('T')[0]`.
9. **Unified CSV Export e1RM Formula (`app/analytics/index.tsx`):** Switched `handleExportCSV` to call `calculateEstimated1RM(w, r)`.

### 3.2 Remaining Functional Bugs
1. **Broken `"Edit Split"` Action (`app/(tabs)/routines.tsx`):**
   Tapping **Edit Split** on any routine card still calls `router.push('/routine-builder/new')` with zero parameters. `RoutineBuilderScreen` has no edit mode or hydration query, so it opens a blank `"My Custom Split"` wizard and creates a duplicate routine instead of editing the selected one.
2. **CSV Export Native No-Op (`app/analytics/index.tsx`):**
   `handleExportCSV` executes only inside `if (Platform.OS === 'web')` and silently does nothing on iOS or Android (`expo-file-system` / `expo-sharing` are not installed).

### 3.3 Half-Built, Orphaned & Stubbed Features
- **Static DB Health Card (`app/settings.tsx`):** While timer and haptics toggles are now persisted via `usePreferencesStore`, the `"Local Supabase DB: Connected & Active"` status card remains hardcoded static text.
- **Autoregulation & Post-Workout Feedback (`src/utils/autoRegEngine.ts`, `src/components/MuscleFeedbackModal.tsx`):** `MuscleFeedbackModal`, `calculateVolumeDelta`, and `calculateNextLoadAndReps` (written in `kg`!) remain unmounted and unused, with no backing database table. Only `getTargetRIR` is called on Dashboard, and it resets to `3 RIR` for all cycles `>= 5` regardless of `routines.cycles_per_routine`.
- **Routine Completion & `"Clone & Repeat"` (`requirements.md` §6):** `routines.cycles_per_routine` and `routine_status = 'completed'` exist in the schema, but `workout/complete.tsx` increments `current_cycle` indefinitely without archiving completed routines or offering baseline promotion cloning.
- **Bodyweight Mode Gaps (`requirements.md` §1.3 & §5.1):** Standalone bodyweight exercises in `/workout/active` still display `"LBS"` inputs and `"Next Target Weight (lbs)"` instead of stripping weight inputs and capturing `session_exercises.next_target_reps` (which is never written anywhere).
- **Set Styles (`src/components/SetRow.tsx`):** `setStyle?: 'normal' | 'warmup' | 'drop' | 'failure'` prop is declared and ignored.
- **Locked Month Picker (`app/history/index.tsx`):** `selectedMonth` and `selectedYear` states exist without prev/next month controls.
- **Orphaned Dev Auth (`src/lib/auth.ts`):** `ensureAuthenticated()` with hardcoded local dev credentials (`dev@weightliftinglog.local` / `password123`) is dead code.

### 3.4 Performance Bottlenecks, Technical Debt & Remaining Backup Risks
- **Unapplied Live Migration on This Host:** Migration 7 (`20261113000000_data_safety_and_day_names.sql`) is written and statically audited, but global `supabase` CLI is absent on this machine and it has not yet been applied or verified against a running Postgres instance.
- **Non-Transactional Multi-Step Client Writes:** Routine creation (`new.tsx`), routine activation (`routines.tsx`), exercise muscle updates (`exercises/[id].tsx`), and workout completion (`complete.tsx`) still execute sequential PostgREST HTTP calls from the client rather than atomic PostgreSQL RPC transactions.
- **Unpaginated Full-History Queries & PostgREST `1,000`-Row Cap:** Dashboard, History, and Analytics each execute `SELECT *, session_exercises(*, session_sets(*))` across *all* user sessions on every screen focus (`useFocusEffect`) with zero caching or pagination. Heavy users will eventually hit `max_rows = 1000` in `supabase/config.toml`, silently truncating older sessions and corrupting lifetime tonnage/PRs.
- **Widespread `any` Typing:** Supabase query responses across `app/` and `src/utils/` rely heavily on untyped `any` rather than generated `Database` types (`supabase gen types typescript`).
- **Offline Initial Load & No Full Backup / Restore:** Starting a *new* workout still requires connectivity once on mount to fetch the routine graph and historical baselines (only active/completed workouts persist offline), and mobile users have no JSON or CSV backup/restore export.
