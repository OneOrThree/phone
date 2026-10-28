-- ════════════════════════════════════════════════════════════════════
-- V87 — 게스트 기기 점유 (GROMO-2036 · 2.0 공개 게스트 세션 발급)
-- ════════════════════════════════════════════════════════════════════
-- ① 왜 필요한가. 게스트 발급은 호출 한 번마다 users 행이 하나 생긴다. 201 응답이 유실돼 앱이
--    재시도하면 같은 사람에게 계정이 둘 생기고, 앱은 그중 하나의 토큰만 들고 나머지는 영영
--    주인 없는 행으로 남는다. login_attempts(V60 계열)가 소셜 로그인에 대해 하는 일을 게스트
--    축에서 하는 표다 — 다만 축이 「앱이 만든 시도 id」가 아니라 «기기» 라서 PK 가 다르다.
--
-- ② 원문을 담지 않는다. device_digest 는 Business 가 자기 비밀로 계산한 keyed HMAC 이고
--    (CredentialDigest, 계정 LLD §3 「앱이 제출한 digest 를 자격으로 수락하지 않는다」),
--    Data 는 원 기기 식별자를 본 적이 없다. 이 표가 통째로 유출돼도 기기 식별자는 나오지 않는다.
--
-- ③ 복구 창이 있는 이유. 창 안에서 같은 digest 는 «같은 유저» 의 새 세션을 받는다. 창이 지나면
--    그 점유는 풀리고 다음 요청이 새 게스트를 만든다. 무기한으로 두면 기기 식별자가 게스트 계정의
--    «영구 bearer 자격» 이 되는데, 계정 LLD §3 은 「게스트의 복구창 밖 처리에는 아직 승인된 대체
--    복구 수단이 없다(Q06)」고 명시한다 — 여기서 그 미결을 임의로 확정하지 않는다.
--    창 길이는 LoginAttemptService.RECOVERY_WINDOW(5분)와 같은 근거다: 유실된 응답의 즉시 재시도.
--
-- ④ 만료 행은 «다음 점유가» 지운다(같은 PK 재사용). 별도 청소 배치를 두지 않았다 — 게스트 생성이
--    GuestLoginRateLimiter 로 IP·전역 양쪽에서 묶여 있어 행 증가율이 작다. 규모가 커지면
--    recovery_expires_at 기준 주기 삭제를 얹는 것이 업그레이드 경로다.
CREATE TABLE guest_device_claims (
    -- keyed HMAC-SHA256 hex 64자. 기기 식별자 원문이 아니다(위 ②).
    -- char 가 아니라 varchar 인 이유: login_attempts.credential_digest 와 같은 타입이어야 하고,
    -- char 는 blank-padded 라 JPA String 매핑(varchar)과 스키마 검증에서 어긋난다.
    device_digest       varchar(64) PRIMARY KEY,
    -- ON DELETE CASCADE: user_main_islands(V81)·user_island_contexts(V57)와 같은 이유다 —
    -- 유저에 종속된 행이고 통합 테스트의 정리 단계가 users 를 하드 삭제한다.
    -- 탈퇴는 소프트 딜리트라 여기서 사라지지 않는다. 대신 발급 경로가 「활성 게스트가 아니면
    -- 점유를 버린다」로 판정하므로, 탈퇴한 유저를 가리키는 행은 다음 요청에서 재사용되지 않는다.
    user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    claimed_at          timestamptz NOT NULL DEFAULT now(),
    recovery_expires_at timestamptz NOT NULL
);

COMMENT ON TABLE guest_device_claims IS
    '게스트 기기 점유 (GROMO-2036, V87) — 복구 창 안에서 같은 기기 digest 의 재시도가 같은 게스트 유저를 '
    '받게 하는 원장. 창이 지나면 점유가 풀려 다음 요청이 새 게스트를 만든다(계정 LLD §3 Q06 미결 보존)';

COMMENT ON COLUMN guest_device_claims.device_digest IS
    'Business 가 계산한 기기 식별자의 keyed HMAC-SHA256 hex. 원문 기기 식별자는 Data 에 도달하지 않는다';

COMMENT ON COLUMN guest_device_claims.recovery_expires_at IS
    '이 점유가 같은 유저를 재생해 주는 마감. 지난 행은 다음 점유가 같은 PK 로 덮어 재사용한다';
