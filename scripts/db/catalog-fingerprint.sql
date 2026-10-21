-- Catalog fingerprint: one row per object kind with an md5 over a normalised
-- description of every object. Same query runs on prod, staging and local; equal
-- hashes mean equal schema for that kind. Read-only. Used by the drift check.
with objs as (
  select 'tables' k, c.relname n, 'rls='||c.relrowsecurity||' force='||c.relforcerowsecurity d
    from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r'
  union all select 'columns', c.relname||'.'||a.attname,
      format_type(a.atttypid,a.atttypmod)||' nn='||a.attnotnull||' id='||a.attidentity::text||' def='||coalesce(pg_get_expr(ad.adbin,ad.adrelid),'')
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
    left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
    where s.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
  union all select 'constraints', conrelid::regclass::text||'.'||conname, pg_get_constraintdef(oid)||' v='||convalidated
    from pg_constraint where connamespace='public'::regnamespace and conrelid<>0
  union all select 'indexes', indexname, indexdef from pg_indexes where schemaname='public'
  union all select 'policies', schemaname||'.'||tablename||'.'||policyname,
      permissive||' '||cmd||' '||roles::text||' '||coalesce(qual,'')||' | '||coalesce(with_check,'')
    from pg_policies where schemaname in ('public','storage')
  union all select 'functions', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      regexp_replace(regexp_replace(pg_get_functiondef(p.oid),'--[^\n]*','','g'),'\s+',' ','g')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
  union all select 'fn_grants', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
        where r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.rolname,p.oid,'execute'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'table_grants', c.relname||'.'||r.rolname,
      (select string_agg(pt, ',' order by pt) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pt
        where has_table_privilege(r.rolname,c.oid,pt))
    from pg_class c join pg_namespace s on s.oid=c.relnamespace, pg_roles r
    where s.nspname='public' and c.relkind in ('r','v') and r.rolname in ('anon','authenticated','service_role')
  union all select 'col_grants', c.relname||'.'||a.attname||'.'||r.rolname, 'select='||has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')||' update='||has_column_privilege(r.rolname,c.oid,a.attnum,'UPDATE')
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace, pg_roles r
    where s.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and r.rolname in ('anon','authenticated')
  union all select 'triggers', tgrelid::regclass::text||'.'||tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not tgisinternal and (n.nspname='public' or (n.nspname='auth' and tgname='on_auth_user_created'))
  union all select 'views', viewname, pg_get_viewdef(('public.'||viewname)::regclass)||' '||coalesce((select array_to_string(reloptions,',') from pg_class where oid=('public.'||viewname)::regclass),'')
    from pg_views where schemaname='public'
  union all select 'buckets', id, public::text||' '||coalesce(file_size_limit::text,'')||' '||coalesce(array_to_string(allowed_mime_types,','),'') from storage.buckets
  union all select 'cron', jobname, schedule||' '||command||' '||active from cron.job
)
select k kind, count(*) objects, md5(string_agg(n||'='||coalesce(d,''), E'\n' order by n)) hash from objs group by k order by k;
