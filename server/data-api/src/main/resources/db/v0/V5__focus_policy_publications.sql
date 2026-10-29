-- 관리자 발행 원장. 기존 focus_reward_policies revision은 수정하지 않고 새 행만 추가한다.
CREATE TABLE focus_reward_policy_publications (
    publication_id uuid PRIMARY KEY,
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
