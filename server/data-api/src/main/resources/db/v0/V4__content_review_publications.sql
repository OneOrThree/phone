-- 전역 개발자 소식과 관리자 검토 스냅샷. 공개 호는 승인 게시 트랜잭션에서만 만든다.
CREATE TABLE content_publications (
    publication_id uuid PRIMARY KEY,
    kind varchar(16) NOT NULL CHECK (kind IN ('NOTICE', 'MAGAZINE')),
    request_digest varchar(64) NOT NULL,
    result jsonb NOT NULL,
    actor varchar(16) NOT NULL CHECK (actor IN ('member-1','member-2','member-3')),
    created_at timestamptz NOT NULL
);
CREATE TABLE developer_notices (
    publication_id uuid PRIMARY KEY,
    title varchar(120) NOT NULL CHECK (length(trim(title)) > 0),
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    published_at timestamptz NOT NULL,
    CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT developer_notices_publication_fk FOREIGN KEY (publication_id)
        REFERENCES content_publications(publication_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX developer_notices_published_idx ON developer_notices(published_at DESC, publication_id DESC);
CREATE TABLE magazine_review_snapshots (
    snapshot_id uuid PRIMARY KEY,
    digest varchar(64) NOT NULL,
    content jsonb NOT NULL,
    actor varchar(16) NOT NULL CHECK (actor IN ('member-1','member-2','member-3')),
    created_at timestamptz NOT NULL
);
