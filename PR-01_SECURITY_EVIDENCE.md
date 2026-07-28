# PR-01 Security Hardening Evidence

Date: 2026-07-28
Phase: PR-01 Security and Access Control Hardening

## Implemented Changes

1. Added migration:
- supabase/migrations/20260728103000_phase1_security_hardening.sql

2. Policy hardening for exercises:
- Replaced update/delete policies so only owners can mutate their own exercise rows.
- System library rows (user_id = 00000000-0000-0000-0000-000000000000) are no longer mutable by standard users.

3. Policy hardening for exercise_muscle_groups:
- Split one broad ALL policy into explicit SELECT/INSERT/UPDATE/DELETE policies.
- SELECT allows own + system exercise mappings.
- INSERT/UPDATE/DELETE only allow owned exercise mappings.

4. Grants hardening:
- Revoked broad table/sequence/routine grants from anon and authenticated.
- Removed schema usage for anon.
- Granted explicit table-level CRUD to authenticated role.
- Revoked default privileges for future object auto-exposure to anon/authenticated.

## System Library Strategy Decision
Selected strategy: Immutable global rows for system exercise library.

Implications:
1. System rows remain readable for authenticated users.
2. System rows are not directly editable/deletable by standard users.
3. Customizations should be user-owned rows (clone-on-edit can be added later if desired).

## Policy Matrix (Expected)

| Role | Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---:|---:|---:|---:|
| anon | all app tables | no | no | no | no |
| authenticated | exercises (owned rows) | yes | yes | yes | yes |
| authenticated | exercises (system rows) | yes | n/a | no | no |
| authenticated | exercise_muscle_groups (owned exercise) | yes | yes | yes | yes |
| authenticated | exercise_muscle_groups (system exercise) | yes | no | no | no |

## Tests Not Yet Executed
The following PR-01 tests are still pending execution in a running local Supabase environment:
1. anon cannot insert/update/delete protected tables
2. owner can mutate own rows
3. non-owner cannot mutate others' rows
4. cannot update/delete system exercise rows

Prepared validation script:
- supabase/snippets/phase1_rls_validation.sql

Why outputs are pending:
- Supabase CLI is not installed in this environment, so migration/test execution could not be run here.

## Suggested Validation SQL (to run next)
```sql
-- Example: verify policy list after migration
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('exercises', 'exercise_muscle_groups')
order by tablename, policyname;
```
