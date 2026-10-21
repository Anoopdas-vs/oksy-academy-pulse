-- Emits exact GRANT/REVOKE statements for anon/authenticated/service_role (+ PUBLIC on
-- functions) for everything in schema public, read from the live ACLs. Read-only.
-- Needed because a plain pg_dump relies on default privileges and drops revocations.
with roles as (select 0::oid oid, 'PUBLIC' name union all select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')),
tbl as (
  select 1 ord, c.relname n, format('revoke all on table public.%I from public, anon, authenticated, service_role;', c.relname) s from pg_class c
   where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')
  union all
  select 2, c.relname||r.name, format('grant %s on table public.%I to %s;', string_agg(a.privilege_type, ', ' order by a.privilege_type), c.relname, case when r.name='PUBLIC' then 'public' else quote_ident(r.name) end)
   from pg_class c, aclexplode(c.relacl) a join roles r on r.oid=a.grantee
   where c.relnamespace='public'::regnamespace and c.relkind in ('r','v') group by c.relname, r.name
  union all
  select 3, c.relname||at.attname||r.name, format('grant %s(%I) on table public.%I to %s;', a.privilege_type, at.attname, c.relname, quote_ident(r.name))
   from pg_class c join pg_attribute at on at.attrelid=c.oid, aclexplode(at.attacl) a join roles r on r.oid=a.grantee
   where c.relnamespace='public'::regnamespace and at.attacl is not null
  union all
  select 4, p.oid::regprocedure::text, format('revoke all on function %s from public, anon, authenticated, service_role;', p.oid::regprocedure) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
  union all
  select 5, p.oid::regprocedure::text||r.name, format('grant execute on function %s to %s;', p.oid::regprocedure, case when r.name='PUBLIC' then 'public' else quote_ident(r.name) end)
   from pg_proc p, aclexplode(p.proacl) a join roles r on r.oid=a.grantee where p.pronamespace='public'::regnamespace and p.prokind='f'
)
select s from tbl order by ord, n;
