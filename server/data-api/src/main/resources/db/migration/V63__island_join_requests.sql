-- ════════════════════════════════════════════════════════════════════
-- V63 — 섬 가입 요청 저장소 + 초대 코드 발급 세대 (GROMO-1760 · island-membership LLD §3.7~§3.11, §4)
-- ════════════════════════════════════════════════════════════════════
-- island_join_requests 는 승인제 섬의 가입 요청(논리 모델 JoinRequest)의 실제 테이블이다.
-- PENDING 은 열려 있는 유일한 상태이고 APPROVED·REJECTED·CANCELLED 는 전부 terminal 이다.
-- 상태 전이는 요청 행의 배타 잠금 아래에서만 일어나며, 신청자 취소·승인/거절·섬 종결 중
-- 둘 이상이 동시에 성공하는 일은 없어야 한다(§3.9 결합 규칙).
--
-- terminal_reason 은 «누가 어떤 사유로 닫았는가»의 내부 사유다 — 공개 status 는
-- cancelled/approved/rejected 뿐이지만, 방장 결정과 신청자 취소·섬 종결을 구분해 둬야
-- §3.8 조회·감사에서 정합한 답을 낼 수 있다.
--
-- invite_link_id 는 초대 근거다. 발급자가 나중에 떠나도 «이 신청은 그 초대로 들어왔다»는 사실은
-- 남아야 승인 커밋의 재검증 근거를 해석할 수 있다 — 그래서 RESTRICT 다. 링크 행 삭제는 허용
-- 코드가 아니라 이미 없다(버전 교체는 슬러그 갱신)지만, 계약이 바뀌어도 요청이 남의 삭제를
-- 거절하게 만들 순 없다.
CREATE TABLE island_join_requests (
    id              uuid PRIMARY KEY,
    island_id       uuid NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
    applicant_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status          varchar(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    terminal_reason varchar(30)
                    CHECK (terminal_reason IN ('APPLICANT_CANCELLED', 'HOST_APPROVED',
                                               'HOST_REJECTED', 'ISLAND_CLOSED')),
    invite_link_id  uuid REFERENCES group_invite_links (id) ON DELETE RESTRICT,
    version         bigint NOT NULL DEFAULT 0,
    created_at      timestamp(6) with time zone NOT NULL DEFAULT now(),
    resolved_at     timestamp(6) with time zone
);

COMMENT ON TABLE island_join_requests IS
    '섬 가입 요청 — 논리 모델 JoinRequest. PENDING 이 유일한 열린 상태이고 전이는 요청 행 잠금 아래서만. GROMO-1760, island-membership LLD §3.7';

-- ── (섬, 신청자)당 PENDING 은 하나 ────────────────────────────────────
-- 동시에 두 신청이 유효해지면 어느 것이 «가입 요청»인지 답할 수 없다. 애플리케이션의 선조회는
-- 트랜잭션 격리상 놓칠 수 있으므로 부분 유니크 인덱스가 최후 방어선이다 — 같은 pending 을
-- 다시 만드는 정상 재시도는 새 행이 아니라 같은 자원을 돌려주는 쪽으로 처리한다(§3.7).
CREATE UNIQUE INDEX uq_island_join_requests_pending
    ON island_join_requests (island_id, applicant_id) WHERE status = 'PENDING';

-- 본인 요청 조회(/me/join-requests/{id} 소유 판정)와 요약의 «본인 최신 신청» 해석.
CREATE INDEX ix_island_join_requests_applicant_island
    ON island_join_requests (applicant_id, island_id, created_at);

-- ── group_invite_links.issuance_epoch ────────────────────────────────
-- 발급 시점 발급자의 membership_epoch. 발급자가 이탈·강퇴·재가입해 세대가 바뀌면 옛 코드는
-- 더 이상 같은 초대가 아니다 — 재가입은 새 코드(새 버전)다. 링크 행의 «폐기»는 행 삭제가
-- 아니라 «세대 불일치로 410 응답»이다 — DB 에 따로 지우는 행이 없어도 발급자 상태 변화가
-- 영구히 폐기된 상태로 남는다(§3.10).
ALTER TABLE group_invite_links ADD COLUMN issuance_epoch bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN group_invite_links.issuance_epoch IS
    '발급 시점 발급자의 group_members.membership_epoch — 이탈/강퇴/재가입으로 세대가 바뀌면 이 코드는 폐기(410). GROMO-1760';

-- 기존 행은 «현재 활성 멤버십의 세대»로 맞춰 둔다 — 발급 이후 세대 변화가 없는 활성 발급자의
-- 코드는 그대로 유효하고, 이미 떠난 발급자의 코드는 남는 0 과 현재 세대(>=1)의 불일치로
-- 자연히 폐기된다.
UPDATE group_invite_links l SET issuance_epoch = m.membership_epoch
    FROM group_members m
    WHERE m.group_id = l.group_id AND m.user_id = l.inviter_id AND m.is_left = false;
