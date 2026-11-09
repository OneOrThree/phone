-- 운영자가 꾸미기 상품을 사용자에게 지급한다. 승인(1인)과 실행(다른 1인)을 나누어 남긴다.
-- 닉네임은 일부러 저장하지 않는다: 탈퇴 때 닉네임이 지워져야 하므로(PII), 승인 때 사용자 UUID 스냅샷만 남기고
-- 화면의 닉네임은 조회 시점 값을 쓴다.
CREATE TABLE customization_grant_approvals (
    approval_id uuid PRIMARY KEY,
    product_id varchar(80) NOT NULL REFERENCES catalog_assets(product_id),
    mode varchar(10) NOT NULL,
    user_ids jsonb NOT NULL,
    reason varchar(200) NOT NULL,
    digest char(64) NOT NULL,
    request_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_by varchar(30),
    CONSTRAINT customization_grant_approval_mode_ck CHECK (mode IN ('USERS', 'ALL')),
    CONSTRAINT customization_grant_approval_users_ck
        CHECK (jsonb_typeof(user_ids) = 'array' AND (mode <> 'ALL' OR user_ids = '[]'::jsonb)),
    CONSTRAINT customization_grant_approval_revocation_ck
        CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- 실행 원장. 한 승인은 한 번만 실행에 쓰인다(approval_id UNIQUE).
-- 승인자 ≠ 실행자는 서비스와 DB 가 둘 다 막는다. cursor_user_id 는 사용자 UUID 오름차순으로 200명씩 처리한
-- 마지막 자리라서, 요청이 중간에 끊겨도 같은 grant_id 로 이어서 한다(중복·누락 없이).
CREATE TABLE customization_grant_executions (
    grant_id uuid PRIMARY KEY,
    approval_id uuid NOT NULL UNIQUE REFERENCES customization_grant_approvals(approval_id),
    request_digest char(64) NOT NULL,
    approved_by varchar(30) NOT NULL,
    actor varchar(30) NOT NULL,
    status varchar(10) NOT NULL,
    cursor_user_id uuid,
    target_count integer NOT NULL,
    granted_count integer NOT NULL DEFAULT 0,
    already_owned_count integer NOT NULL DEFAULT 0,
    skipped_count integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    CONSTRAINT customization_grant_exec_status_ck CHECK (status IN ('RUNNING', 'COMPLETED')),
    CONSTRAINT customization_grant_exec_counts_ck
        CHECK (target_count >= 0 AND granted_count >= 0 AND already_owned_count >= 0 AND skipped_count >= 0),
    CONSTRAINT customization_grant_distinct_actors_ck CHECK (approved_by <> actor),
    CONSTRAINT customization_grant_exec_completed_ck CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
