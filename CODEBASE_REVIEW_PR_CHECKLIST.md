# WeightLiftingLog PR Execution Tracker

Date: 2026-07-28
Source Plan: CODEBASE_REVIEW_AND_PHASE_PLAN.md
Purpose: Strict checklist for implementation and verification across PRs.

## Usage Rules
- One checkbox equals one verifiable unit of work.
- A box may only be checked when evidence is linked in the PR description.
- Required evidence types:
  - Code diff link
  - Test output or screenshot
  - Migration output (if DB change)
  - Short note on risk/rollback

---

## PR-00: Baseline and Safety Net

### Scope
- [ ] Confirm authoritative schema state for local and target environments.
- [ ] Record current migration head and applied migration list.
- [ ] Build baseline smoke checklist for core flows.
- [ ] Capture pre-change DB integrity snapshots for sessions/session_exercises/session_sets.

### Tests
- [ ] Manual smoke run: auth login/signup flow.
- [ ] Manual smoke run: routine create/activate.
- [ ] Manual smoke run: active workout start/log/finish.
- [ ] Manual smoke run: history list/detail render.
- [ ] Manual smoke run: analytics render/export action.

### Evidence
- [ ] Attach migration list output.
- [ ] Attach baseline smoke checklist results.
- [ ] Attach DB snapshot query results.

### Exit Criteria
- [ ] Baseline behavior documented and reproducible by another reviewer.

---

## PR-01: Security and Access Control Hardening

### Scope
- [x] Replace broad GRANT ALL usage with least-privilege grants.
- [x] Remove/limit default privilege grants for anon/authenticated.
- [x] Restrict system exercise rows to read-only for standard users.
- [x] Ensure exercise_muscle_groups policy matches ownership intent.
- [ ] Document chosen strategy for system library rows:
  - [x] Immutable global rows
  - [ ] Clone-on-edit user rows

### Tests
- [ ] anon cannot insert/update/delete protected tables.
- [ ] authenticated owner can mutate own rows.
- [ ] authenticated non-owner cannot mutate others' rows.
- [ ] authenticated user cannot delete system exercise rows.
- [ ] authenticated user cannot update system exercise rows.

### Evidence
- [x] Attach SQL migration diff.
- [ ] Attach RLS test script and outputs.
- [x] Attach policy matrix (role x table x operation).

Evidence references:
- PR-01_SECURITY_EVIDENCE.md
- supabase/migrations/20260728103000_phase1_security_hardening.sql
- supabase/snippets/phase1_rls_validation.sql

### Exit Criteria
- [ ] All RLS regression tests pass for anon/owner/non-owner.

---

## PR-02: Session Persistence and Lifecycle Correctness

### Scope
- [x] Resolve duration_seconds drift:
  - [x] Add duration_seconds migration, or
  - [x] Remove duration_seconds app dependence and compute duration from timestamps.
- [x] Persist routine_day_id on session insert.
- [x] Explicitly set session status to completed on successful finish.
- [x] Align uniqueness assumptions (routine_id, routine_day_id, cycle_number) with app write logic.

### Tests
- [x] Integration: session insert includes expected identifying fields.
- [x] Integration: completion transitions session status to completed.
- [x] Integration: duplicate session attempt for same routine/day/cycle is rejected as expected.
- [x] Integration: history detail reflects persisted session correctly.

### Evidence
- [x] Attach migration output and schema diff (supabase/migrations/20260728110000_phase2_session_persistence.sql).
- [x] Attach code diffs (app/workout/active.tsx, app/workout/complete.tsx, app/history/index.tsx, app/history/[id].tsx).

### Exit Criteria
- [ ] End-to-end completion path succeeds in clean environment with consistent DB state.

---

## PR-03: Active Workout Integrity and Requirement Alignment

### Scope
- [ ] Add strict client validation for set inputs (weight/reps).
- [ ] Add DB check constraints for valid numeric ranges.
- [ ] Remove large JSON payload routing from workout completion handoff.
- [ ] Implement identifier-based handoff and persisted fetch.
- [ ] Implement bodyweight-only reps-centric UI:
  - [ ] Hide weight input and weight header for bodyweight exercises.
  - [ ] Capture next target reps for bodyweight exercises.
  - [ ] Display next target reps where applicable.
- [ ] Enforce V1 locked structure behavior on active workout:
  - [ ] Remove or gate add-set mutation during active tracking.

### Tests
- [ ] Unit: validator rejects malformed/non-numeric values.
- [ ] Unit: validator rejects negative/out-of-range values.
- [ ] Integration: bodyweight flow persists reps correctly without weight dependency.
- [ ] Integration: large workout flow no longer depends on route payload size.
- [ ] Regression: weighted exercise flow remains intact.

### Evidence
- [ ] Attach validator tests output.
- [ ] Attach DB constraint migration output.
- [ ] Attach UI screenshots for bodyweight and weighted modes.
- [ ] Attach end-to-end completion artifact.

### Exit Criteria
- [ ] Input integrity and bodyweight requirements pass all tests.

---

## PR-04: Error Handling and Recovery UX

### Scope
- [ ] Replace log-only failures with user-facing error states.
- [ ] Add retry action for failed critical reads/writes.
- [ ] Fix completion failure path to never mark success on error.
- [ ] Standardize loading/error pattern across core screens/hooks.

### Tests
- [ ] Simulated network failure during workout completion surfaces actionable error.
- [ ] Retry action succeeds after transient failure.
- [ ] No success state is shown on failed completion save.
- [ ] Exercise/routine/history fetch failures display error UI.

### Evidence
- [ ] Attach screenshots/video of failure and retry UX.
- [ ] Attach test output for failure-path scenarios.

### Exit Criteria
- [ ] No silent failures remain in critical user flows.

---

## PR-05: Type Safety and Cleanup

### Scope
- [ ] Replace high-risk any usages in core workflow screens.
- [ ] Add shared domain types for routines/sessions/exercises and related projections.
- [ ] Remove broken or unused imports and dead code paths.
- [ ] Resolve orphaned component/type references or integrate intentionally.

### Tests
- [ ] Type-check passes with strict mode enabled.
- [ ] Lint passes with no new warnings in touched files.
- [ ] Regression smoke on dashboard, workout, history, analytics.

### Evidence
- [ ] Attach type-check output.
- [ ] Attach lint output.
- [ ] Attach list of removed dead paths/imports.

### Exit Criteria
- [ ] Core workflow paths compile without broad any reliance.

---

## PR-06: Performance and Scalability Pass

### Scope
- [ ] Introduce cache and explicit invalidation for focus-based refetches.
- [ ] Narrow Supabase select projections to required fields in heavy queries.
- [ ] Add pagination/limits where lists can grow (history/analytics).

### Tests
- [ ] Compare network request counts before vs after in repeated tab navigation.
- [ ] Verify cache invalidation after create/update/delete operations.
- [ ] Verify history and analytics correctness under pagination.

### Evidence
- [ ] Attach request-count comparison table.
- [ ] Attach performance notes and screen load timings.

### Exit Criteria
- [ ] Reduced redundant calls without stale-data regressions.

---

## PR-07: Test Suite and Release Readiness

### Scope
- [ ] Add unit tests for auto-reg utilities and validators.
- [ ] Add integration tests for workout completion and cycle/day advancement.
- [ ] Add RLS security tests (anon/owner/non-owner).
- [ ] Add end-to-end tests for key user journey.
- [ ] Add CI gates for type-check, lint, unit, integration, E2E.

### Tests
- [ ] CI pipeline green on all required gates.
- [ ] Manual release checklist executed by QA/product owner.

### Evidence
- [ ] Attach CI run link and artifacts.
- [ ] Attach release sign-off checklist.

### Exit Criteria
- [ ] All critical/high findings closed with automated or documented manual coverage.

---

## Cross-PR Governance Checklist
- [ ] Each PR includes risk statement and rollback plan.
- [ ] Each PR includes migration safety notes (if DB touched).
- [ ] Each PR includes test evidence for both success and failure paths.
- [ ] Each PR keeps scope limited to one phase objective.
- [ ] Each PR updates this tracker status.

---

## Final Go/No-Go Checklist
- [ ] Critical findings resolved.
- [ ] High findings resolved or accepted with explicit risk sign-off.
- [ ] RLS tests passing in target environment.
- [ ] End-to-end workout completion verified.
- [ ] History and analytics consistency verified against DB rows.
- [ ] Release owner approval recorded.
