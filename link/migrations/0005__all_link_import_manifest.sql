ALTER TABLE migration_runs ADD COLUMN expected_links bigint;
ALTER TABLE migration_runs ADD COLUMN link_checksum text;
CREATE TABLE migration_links (
    migration_id text NOT NULL REFERENCES migration_runs(id),
    link_id uuid NOT NULL REFERENCES links(id),
    source_checksum text NOT NULL,
    frozen_source jsonb NOT NULL,
    PRIMARY KEY (migration_id, link_id)
);
