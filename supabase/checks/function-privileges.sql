-- Pre-release check (founder, 2026-10-23): run on staging AND production
-- before every release; the fingerprints must match. If they don't, compare
-- the "grants" lists — a function the app calls must be granted on both.
-- Read-only.
select md5(string_agg(g, ',' order by g)) as fingerprint,
       count(*) as grants,
       string_agg(g, E'\n' order by g) as grants_list
from (
  select p.oid::regprocedure::text || ' -> ' || r.rolname as g
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname not like 'zz\_seed\_%'  -- staging-only demo seed
    and has_function_privilege(r.rolname, p.oid, 'execute')
) x;
