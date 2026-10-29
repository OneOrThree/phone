-- public의 관계·열·제약·인덱스·트리거·함수·정책·시퀀스 정의를 비교한다. 데이터/소유자/ACL은 별도 운영 책임이다.
SELECT definition FROM (
 SELECT 'relation|'||c.relname||'|'||c.relkind::text||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT 'column|'||c.relname||'|'||a.attnum||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)
 ||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text
 ||'|'||coalesce(coll.collname,'')
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
 WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 'constraint|'||c.relname||'|'||p.conname||'|'||pg_get_constraintdef(p.oid,true)||'|'||p.convalidated
 FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'index|'||c.relname||'|'||pg_get_indexdef(i.indexrelid)||'|'||i.indisvalid||'|'||i.indisready
 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'trigger|'||c.relname||'|'||pg_get_triggerdef(t.oid,true)||'|'||t.tgenabled::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'function|'||pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind IN ('f','p')
 UNION ALL
 SELECT 'view|'||c.relname||'|'||pg_get_viewdef(c.oid,true)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')
 UNION ALL
 SELECT 'policy|'||c.relname||'|'||p.polname||'|'||p.polcmd::text||'|'||p.polpermissive||'|'||p.polroles::text
 ||'|'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'sequence|'||c.relname||'|'||s.seqtypid::regtype||'|'||s.seqstart||'|'||s.seqincrement||'|'
 ||s.seqmax||'|'||s.seqmin||'|'||s.seqcache||'|'||s.seqcycle
 FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
) objects ORDER BY definition COLLATE "C"
