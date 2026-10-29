-- 건설 정책도 기존 관리 발행 영수증에 적용 전후 값을 불변으로 보존한다.
ALTER TABLE content_publications DROP CONSTRAINT content_publications_kind_check;
ALTER TABLE content_publications ADD CONSTRAINT content_publications_kind_check
    CHECK (kind IN ('NOTICE', 'MAGAZINE', 'CONSTRUCTION'));
