ALTER TABLE migration_runs ADD COLUMN expected_links bigint;
ALTER TABLE migration_runs ADD COLUMN link_checksum text;
CREATE TABLE migration_links (
    migration_id text NOT NULL REFERENCES migration_runs(id),
    link_id uuid NOT NULL REFERENCES links(id),
    source_checksum text NOT NULL,
    frozen_source jsonb NOT NULL,
    PRIMARY KEY (migration_id, link_id)
);

-- aggregate snapshot 보호는 run을 모른 채 link_id로 이관 여부를 조회한다.
CREATE INDEX idx_migration_links_link ON migration_links (link_id);
