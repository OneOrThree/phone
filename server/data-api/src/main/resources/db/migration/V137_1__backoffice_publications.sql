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

-- 건설 정책도 기존 관리 발행 영수증에 적용 전후 값을 불변으로 보존한다.
ALTER TABLE content_publications DROP CONSTRAINT content_publications_kind_check;
ALTER TABLE content_publications ADD CONSTRAINT content_publications_kind_check
    CHECK (kind IN ('NOTICE', 'MAGAZINE', 'CONSTRUCTION'));

-- 승인자는 자기 서비스 토큰으로 서명에 해당하는 불변 영수증을 남긴다.
CREATE TABLE focus_reward_policy_approvals (
    approval_id uuid PRIMARY KEY,
    expected_revision integer NOT NULL,
    policy_snapshot jsonb NOT NULL,
    policy_digest char(64) NOT NULL,
    request_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_by varchar(30),
    CONSTRAINT focus_policy_approval_revocation_ck
        CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- 관리자 발행 원장. 기존 focus_reward_policies revision은 수정하지 않고 새 행만 추가한다.
CREATE TABLE focus_reward_policy_publications (
    publication_id uuid PRIMARY KEY,
    approval_id uuid NOT NULL UNIQUE REFERENCES focus_reward_policy_approvals(approval_id),
    revision integer NOT NULL UNIQUE REFERENCES focus_reward_policies(revision),
    previous_revision integer NOT NULL,
    before_policy jsonb NOT NULL,
    after_policy jsonb NOT NULL,
    request_digest char(64) NOT NULL,
    approved_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    actor varchar(30) NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT focus_policy_distinct_actors_ck CHECK (approved_by <> actor)
);
