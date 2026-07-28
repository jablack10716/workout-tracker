-- Phase 1 RLS Validation Script
-- Run after applying migrations in a local Supabase/Postgres environment.

-- 1) Inspect policies
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('exercises', 'exercise_muscle_groups')
order by tablename, policyname;

-- 2) Inspect grants
select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'exercises',
    'exercise_muscle_groups',
    'routines',
    'routine_days',
    'routine_exercises',
    'sessions',
    'session_exercises',
    'session_sets'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- 3) Validate anon restrictions (run as anon role/session in your local setup)
-- Expected: deny mutations and deny broad reads.
-- Example checks to run in the appropriate auth context:
-- select * from exercises limit 5;
-- insert into exercises (user_id, name, is_bodyweight_only, default_rest_timer_seconds)
-- values ('00000000-0000-0000-0000-000000000000', 'Should Fail', false, 90);

-- 4) Validate authenticated owner permissions
-- Expected: owner can CRUD own rows.
-- Example checks to run in owner auth context:
-- insert into exercises (user_id, name, is_bodyweight_only, default_rest_timer_seconds)
-- values ('<owner-uuid>', 'Owner Exercise', false, 90);
-- update exercises set name = 'Owner Exercise Updated'
-- where user_id = '<owner-uuid>' and name = 'Owner Exercise';
-- delete from exercises where user_id = '<owner-uuid>' and name = 'Owner Exercise Updated';

-- 5) Validate authenticated non-owner restrictions
-- Expected: cannot mutate another user's rows.
-- update exercises set name = 'Should Fail'
-- where user_id = '<other-user-uuid>';
-- delete from exercises where user_id = '<other-user-uuid>';

-- 6) Validate system library immutability for standard users
-- Expected: no update/delete allowed where user_id is system UUID.
-- update exercises set name = 'Should Fail'
-- where user_id = '00000000-0000-0000-0000-000000000000';
-- delete from exercises
-- where user_id = '00000000-0000-0000-0000-000000000000';
