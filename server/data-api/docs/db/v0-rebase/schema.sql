-- 권한·소유자는 환경별로 유지한다. 애플리케이션 구조만 정렬된 JSON으로 비교한다.
SET search_path = public, pg_catalog;
SELECT jsonb_build_object(
    'relations', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name) FROM (
        SELECT c.relname AS name, c.relkind::text AS kind, c.relrowsecurity AS rls,
               c.relforcerowsecurity AS force_rls, c.relpersistence::text AS persistence,
               c.relreplident::text AS replica_identity, pg_get_partkeydef(c.oid) AS partition_key,
               pg_get_expr(c.relpartbound, c.oid) AS partition_bound,
               CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, false) END AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
          AND c.relname <> 'flyway_schema_history'
    ) r),
    'columns', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.relation, r.name) FROM (
        SELECT c.relname AS relation, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS not_null, a.attidentity::text AS identity, a.attgenerated::text AS generated,
               pg_get_expr(d.adbin, d.adrelid, false) AS default_value,
               CASE WHEN a.attcollation <> 0 THEN a.attcollation::regcollation::text END AS collation
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
          AND c.relname <> 'flyway_schema_history' AND a.attnum > 0 AND NOT a.attisdropped
    ) r),
    'constraints', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.relation, r.name) FROM (
        SELECT c.relname AS relation, k.conname AS name, k.contype::text AS type,
               pg_get_constraintdef(k.oid, false) AS definition, k.convalidated AS validated
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname <> 'flyway_schema_history'
    ) r),
    'indexes', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.relation, r.name) FROM (
        SELECT c.relname AS relation, i.relname AS name, pg_get_indexdef(i.oid) AS definition,
               x.indisvalid AS valid, x.indisready AS ready
        FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname <> 'flyway_schema_history'
    ) r),
    'triggers', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.relation, r.name) FROM (
        SELECT c.relname AS relation, t.tgname AS name, t.tgenabled::text AS enabled,
               pg_get_triggerdef(t.oid, false) AS definition
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ) r),
    'functions', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name, r.arguments) FROM (
        SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
               pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
              AND d.objid = p.oid AND d.deptype = 'e')
    ) r),
    'sequences', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name) FROM (
        SELECT sequencename AS name, data_type::text AS type, start_value, min_value, max_value,
               increment_by, cycle, cache_size FROM pg_sequences WHERE schemaname='public'
    ) r),
    'types', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name) FROM (
        SELECT ty.typname AS name, ty.typtype::text AS kind, ty.typbasetype::regtype::text AS base,
               ty.typnotnull AS not_null, ty.typdefault AS default_value,
               (SELECT jsonb_agg(en.enumlabel ORDER BY en.enumsortorder)
                FROM pg_enum en WHERE en.enumtypid=ty.oid) AS labels
        FROM pg_type ty JOIN pg_namespace n ON n.oid=ty.typnamespace
        WHERE n.nspname='public' AND ty.typtype IN ('d','e')
    ) r),
    'policies', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.tablename, r.policyname)
        FROM (SELECT * FROM pg_policies WHERE schemaname = 'public') r),
    'extensions', (SELECT jsonb_agg(jsonb_build_object('name', e.extname, 'version', e.extversion)
        ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE n.nspname = 'public')
);
