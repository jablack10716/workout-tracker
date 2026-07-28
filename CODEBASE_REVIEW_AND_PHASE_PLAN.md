# WeightLiftingLog Deep Review: Findings and Phased Completion Plan

Date: 2026-07-28
Reviewer: GitHub Copilot (GPT-5.3-Codex)

## Scope
This review covers architecture, app workflows, Supabase schema and RLS, data integrity, error handling, performance, and alignment with stated product requirements.

## Executive Summary
The codebase has a strong foundation and clear product direction, but there are several high-impact correctness and security issues that should be addressed before production use. The highest-risk areas are:

1. Schema and app write-path drift in session persistence
2. Overly broad SQL grants and mutable system-library rows
3. Workout completion state correctness and validation gaps
4. Requirements mismatches in bodyweight handling and locked workout behavior

The phased plan below is organized to reduce risk quickly, then improve resilience and maintainability.

---

## Complete Findings List

## Critical Findings

### C1. App-schema drift on session duration fields
- App reads and writes duration_seconds, but the initial sessions table migration does not define it.
- Risk: session writes or reads may fail, or behavior can differ by environment.
- Evidence:
  - app/workout/complete.tsx writes duration_seconds
  - app/workout/active.tsx passes duration_seconds
  - app/history/index.tsx and app/history/[id].tsx read duration_seconds
  - supabase/migrations/20260713165135_initial_schema.sql does not define duration_seconds in sessions

### C2. Overly permissive grants for anon and authenticated roles
- Broad GRANT ALL and ALTER DEFAULT PRIVILEGES are applied to anon and authenticated.
- Risk: unnecessary surface area and accidental privilege escalation if policy assumptions change.
- Evidence:
  - supabase/migrations/20260724075500_add_rls_policies.sql

### C3. System exercise rows are mutable by normal users
- Update/delete policy includes rows where user_id is system UUID.
- Risk: shared default exercise library can be altered or deleted by regular users.
- Evidence:
  - supabase/migrations/20260724075500_add_rls_policies.sql

### C4. Workout completion state does not align with session lifecycle design
- Sessions default to in_progress in schema, but completion flow does not explicitly set completed status.
- routine_day_id is part of uniqueness semantics in schema but is not set during session insert.
- Risk: inconsistent lifecycle semantics, duplicate/ambiguous sessions across cycle/day.
- Evidence:
  - app/workout/complete.tsx
  - supabase/migrations/20260713165135_initial_schema.sql

## High Findings

### H1. Save failure path can present as success
- Completion catch path currently sets saved state as true.
- Risk: user believes workout persisted when it did not.
- Evidence:
  - app/workout/complete.tsx

### H2. Workout payload passed via route params
- Full workout object is JSON-stringified into navigation params.
- Risk: brittle payload size limits, parsing failures, and difficult recovery/retry semantics.
- Evidence:
  - app/workout/active.tsx
  - app/workout/complete.tsx

### H3. Input validation gaps for set values
- Numeric coercion to 0 is used for invalid values during persistence.
- Risk: silent data corruption in volume and performance analytics.
- Evidence:
  - app/workout/complete.tsx
  - src/components/SetRow.tsx

### H4. Bodyweight workflow mismatch with requirements
- Weight column/input is still shown and next target remains weight-centric in active logging.
- Risk: inconsistent UX and incorrect data model behavior for bodyweight-only exercises.
- Evidence:
  - app/workout/active.tsx
  - src/components/SetRow.tsx
  - requirements.md

### H5. Locked workout behavior mismatch with requirements
- Active workout allows adding sets.
- Requirement says active structure should be locked in V1.
- Evidence:
  - app/workout/active.tsx
  - requirements.md

## Medium Findings

### M1. Routine activation is non-atomic
- Uses two separate updates for draft-all then activate-one.
- Risk: race conditions under concurrency/network interruptions.
- Evidence:
  - app/(tabs)/routines.tsx

### M2. Type safety and dead-code issues
- Multiple any states and a broken/unused import path in analytics.
- Orphaned feedback modal references a type path that does not exist in workspace.
- Evidence:
  - app/(tabs)/index.tsx
  - app/workout/active.tsx
  - app/history/index.tsx
  - app/history/[id].tsx
  - app/analytics/index.tsx
  - src/components/MuscleFeedbackModal.tsx

### M3. Inconsistent user-facing error handling
- Several data-fetch/save paths suppress actionable feedback.
- Risk: silent failure perception.
- Evidence:
  - src/hooks/useExercises.ts
  - app/(tabs)/routines.tsx
  - app/history/index.tsx
  - app/workout/complete.tsx

### M4. Refetch-heavy screen focus patterns
- Several screens refetch entire datasets on focus.
- Risk: unnecessary network/battery use and slower UX at scale.
- Evidence:
  - app/(tabs)/index.tsx
  - app/(tabs)/routines.tsx
  - app/(tabs)/exercises.tsx
  - app/history/index.tsx

---

## Phased Completion Plan

## Phase 0: Baseline and Safety Net
Goal: Establish reliable verification before changing behavior.

Tasks
1. Confirm authoritative runtime schema in local and target environment.
2. Add baseline smoke test checklist for core flows: auth, routine creation, active workout, completion, history, analytics.
3. Capture pre-change query snapshots for sessions, session_exercises, session_sets integrity.

Completion Criteria
1. Team has an agreed source of truth for schema and migration state.
2. Baseline flow checklist is executable and documented.

Test Plan
1. Manual smoke run across all primary tabs and completion flow.
2. DB snapshot sanity checks for row counts and FK consistency.

## Phase 1: Security and Access Control Hardening
Goal: Remove highest-risk data exposure and shared-data mutation risks.

Tasks
1. Replace broad grants with least-privilege grants by table and operation.
2. Restrict system exercise rows to read-only for regular users.
3. Revalidate exercise_muscle_groups policy semantics against intended ownership model.
4. Decide and implement system-library strategy:
   - Option A: immutable global library
   - Option B: clone-on-edit into user-owned row

Completion Criteria
1. anon cannot mutate protected data.
2. authenticated users can only mutate owned rows.
3. system library rows cannot be edited/deleted by standard users.

Test Plan
1. RLS regression tests for anon, owner, non-owner users.
2. Attempt update/delete on system exercise rows as normal user and verify denial.
3. Validate intended read access for system library rows.

## Phase 2: Session Persistence and Lifecycle Correctness
Goal: Make workout completion persistence deterministic and schema-aligned.

Tasks
1. Resolve duration_seconds drift:
   - Add migration for duration_seconds, or
   - Remove app usage and calculate duration from timestamps.
2. Ensure routine_day_id is persisted on session insert.
3. Explicitly set session status to completed on finish.
4. Align uniqueness and lifecycle assumptions with actual insert/update behavior.

Completion Criteria
1. Workout completion succeeds consistently in clean environment.
2. Sessions include all required identifying fields.
3. Session lifecycle state transitions are explicit and queryable.

Test Plan
1. Integration tests for session insert and completion transition.
2. Validate uniqueness behavior across routine/day/cycle.
3. End-to-end run: start workout, log sets, complete, verify history detail consistency.

## Phase 3: Active Workout Data Integrity and UX Rules
Goal: Prevent silent data corruption and align behavior with product requirements.

Tasks
1. Add strict client validation for weight/reps/set inputs.
2. Add DB-level check constraints for valid numeric ranges.
3. Remove full payload passing via route params; pass identifier and fetch persisted draft/session.
4. Make bodyweight-only mode reps-centric:
   - hide weight input/column
   - track and present next target reps
5. Enforce V1 locked structure rules in active workout (no set-count mutation while active).

Completion Criteria
1. Invalid set inputs are blocked or visibly rejected.
2. Bodyweight exercises show correct UI and persistence behavior.
3. Active workout respects locked structure constraints in V1.

Test Plan
1. Validation tests for malformed, negative, and out-of-range inputs.
2. Bodyweight-only workflow tests for display and persistence.
3. Route/navigation robustness tests for large workout scenarios.

## Phase 4: Error Handling, Reliability, and Recovery
Goal: Ensure failures are visible, recoverable, and user-safe.

Tasks
1. Replace silent catch/log-only paths with user-facing error states and retry actions.
2. Fix completion failure UX so errors are never marked successful.
3. Add resilient retry/backoff strategy for critical writes.
4. Standardize async loading/error pattern in shared hooks and screens.

Completion Criteria
1. No critical write path can fail silently.
2. Users can retry failed operations without data loss.

Test Plan
1. Simulated network failure during completion write.
2. Session expiration/interrupted-auth path validation.
3. QA checks for meaningful error copy and retry success.

## Phase 5: Type Safety, Maintainability, and Cleanup
Goal: Reduce future regression risk and improve developer velocity.

Tasks
1. Replace high-impact any usages with shared domain types.
2. Remove broken/unused imports and dead code paths.
3. Resolve orphaned component/type references or integrate intentionally.
4. Add typed data mappers for Supabase responses.

Completion Criteria
1. Core workflow screens no longer depend on broad any state.
2. Analytics and feedback modules compile cleanly with no dead references.

Test Plan
1. Type-check and lint gate in CI.
2. Unit tests for type-safe mapping and transformation functions.

## Phase 6: Performance and Scalability Improvements
Goal: Improve responsiveness and reduce unnecessary network load.

Tasks
1. Introduce cache/invalidation for focus-based fetches.
2. Narrow select projections to required fields only where practical.
3. Add pagination/limits for history and heavy analytics datasets.

Completion Criteria
1. Fewer redundant network calls on tab switching.
2. Noticeable improvement in load latency on history/analytics views.

Test Plan
1. Compare request counts before vs after with identical navigation paths.
2. Validate correctness of cache invalidation after writes.

## Phase 7: Test Suite Completion and Release Readiness
Goal: Ensure confidence for production deployment.

Tasks
1. Unit tests:
   - auto-reg logic
   - input validators
   - mapper/util functions
2. Integration tests:
   - workout completion pipeline
   - cycle/day advancement
   - routine activation semantics
3. Security tests:
   - RLS ownership and anon restrictions
4. E2E tests:
   - sign up/log in
   - create routine
   - complete workout
   - verify history and analytics rendering

Completion Criteria
1. All critical/high findings resolved and covered by tests.
2. Release checklist passed for auth, persistence, and RLS safety.

Test Plan
1. CI pipeline with type-check, lint, unit, integration, and E2E stages.
2. Manual sign-off checklist for product owner and QA.

---

## Suggested Execution Order by Risk
1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7

---

## Strong Areas Observed
1. Clear separation of app sections and navigation structure
2. Good conceptual routine/cycle design
3. Useful auto-reg foundation in utility layer
4. Consistent visual style and interaction intent across screens

---

## Implementation Notes
- Keep migrations additive and reversible.
- Prefer one behavior-changing axis per pull request to simplify QA.
- For each phase, include both success-path and failure-path test evidence.
