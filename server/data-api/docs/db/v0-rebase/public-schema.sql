-- 지원 범위는 public 한 곳이다. 외부 FK의 CASCADE와 지문 밖 객체의 의존성을 허용하지 않는다.
-- 읽기 전용 계획과 잠금을 잡은 적용 트랜잭션이 같은 검사를 사용한다.
DO $schema_guard$
DECLARE unsupported text[];
BEGIN
    SELECT array_agg(n.nspname::text ORDER BY n.nspname) INTO unsupported
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('public', 'information_schema')
      AND left(n.nspname, 3) <> 'pg_'
      AND EXISTS (SELECT 1 FROM pg_depend d
          WHERE d.refclassid = 'pg_namespace'::regclass AND d.refobjid = n.oid);
    IF cardinality(unsupported) > 0 THEN
        RAISE EXCEPTION 'public 밖 사용자 객체가 있어 전환을 거부합니다: %', array_to_string(unsupported, ', ');
    END IF;
END $schema_guard$;
