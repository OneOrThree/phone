-- GROMO-1976: Gmail은 DB 트랜잭션에 묶을 수 없는 외부 side effect다.
-- 사용자+요청키별 영속 intent와 lease를 두어 동시 발송을 한 작업자로 제한하고,
-- 응답 유실 뒤에도 같은 메일 snapshot과 완료 영수증을 재생한다.
CREATE TABLE public.report_deliveries (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL,
    request_id uuid NOT NULL,
    case_id varchar(64) NOT NULL,
    confirmation_token uuid NOT NULL,
    request_fingerprint char(64) NOT NULL,
    block_requested boolean NOT NULL,
    author_id uuid,
    mail_subject varchar(255),
    mail_body text,
    snapshot_stored_at timestamptz,
    status varchar(16) NOT NULL DEFAULT 'PENDING',
    lease_token uuid,
    lease_expires_at timestamptz,
    blocked boolean,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    completed_at timestamptz,
    CONSTRAINT uq_report_deliveries_request UNIQUE (reporter_id, request_id),
    CONSTRAINT uq_report_deliveries_case UNIQUE (case_id),
    CONSTRAINT ck_report_deliveries_status CHECK (status IN ('PENDING', 'EMAIL_CONFIRMED', 'EXPIRED', 'COMPLETED')),
    CONSTRAINT ck_report_deliveries_prepared CHECK (
        (status = 'PENDING' AND (
            (author_id IS NULL AND mail_subject IS NULL AND mail_body IS NULL AND snapshot_stored_at IS NULL)
            OR (author_id IS NOT NULL AND mail_subject IS NOT NULL AND mail_body IS NOT NULL
                AND snapshot_stored_at IS NOT NULL)
        ))
        OR (status = 'EMAIL_CONFIRMED' AND author_id IS NOT NULL AND mail_subject IS NULL AND mail_body IS NULL
            AND snapshot_stored_at IS NOT NULL)
        OR (status IN ('EXPIRED', 'COMPLETED') AND author_id IS NULL AND mail_subject IS NULL AND mail_body IS NULL
            AND snapshot_stored_at IS NULL)
    ),
    CONSTRAINT ck_report_deliveries_completed CHECK (
        (status IN ('PENDING', 'EMAIL_CONFIRMED', 'EXPIRED') AND completed_at IS NULL AND blocked IS NULL)
        OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND blocked IS NOT NULL)
    )
);

CREATE INDEX ix_report_deliveries_pending_lease
    ON public.report_deliveries (lease_expires_at)
    WHERE status IN ('PENDING', 'EMAIL_CONFIRMED');

CREATE INDEX ix_report_deliveries_reporter_created
    ON public.report_deliveries (reporter_id, created_at);
