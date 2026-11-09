-- 꾸미기 추첨 풀 승인·발행 (GROMO-2829).
-- 추첨 풀은 customization_reward_items 의 «가장 큰 revision 행들»이다. 운영자가 풀을 바꾸면 기존 revision 은
-- 고치지 않고(focus_settlements 가 (revision, product_id) 를 FK 로 가리킨다) 새 revision 의 정책 행과 아이템 행을 더한다.
-- 이 두 표는 그 발행의 영수증과 감사 원장이다. 집중 정책(V6)과 같은 모양이다.

-- 승인자는 자기 서비스 토큰으로 서명에 해당하는 불변 영수증을 남긴다.
-- product_ids 는 승인 때 정한 풀 전체 스냅샷(오름차순 상품 id 배열)이다 — 발행 요청이 이 스냅샷과 다르면 거절한다.
CREATE TABLE customization_reward_pool_approvals (
    approval_id uuid PRIMARY KEY,
    expected_revision integer NOT NULL,
    product_ids jsonb NOT NULL,
    approved_digest char(64) NOT NULL,
    request_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_by varchar(30),
    CONSTRAINT customization_pool_approval_revocation_ck
        CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- 관리자 발행 원장. 기존 customization_reward_policies revision 은 수정하지 않고 새 행만 추가한다.
-- 전후 풀(before/after_product_ids)을 남겨 «누가 어떤 상품을 넣고 뺐는지» 를 나중에도 되짚을 수 있게 한다.
CREATE TABLE customization_reward_pool_publications (
    publication_id uuid PRIMARY KEY,
    approval_id uuid NOT NULL UNIQUE REFERENCES customization_reward_pool_approvals(approval_id),
    revision integer NOT NULL UNIQUE REFERENCES customization_reward_policies(revision),
    previous_revision integer NOT NULL,
    before_product_ids jsonb NOT NULL,
    after_product_ids jsonb NOT NULL,
    request_digest char(64) NOT NULL,
    approved_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    actor varchar(30) NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customization_pool_distinct_actors_ck CHECK (approved_by <> actor)
);
