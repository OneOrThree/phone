-- ════════════════════════════════════════════════════════════════════
-- V52 — 위성(알림·링크)과 코어 사이의 대체 계약용 스키마 (GROMO-1659 · GROMO-1660 / 정본 A22)
-- ════════════════════════════════════════════════════════════════════
-- V51 이 「커밋과 함께 이벤트가 남는가」를 풀었다면, 여기서 만드는 것은 그 봉투에 실을 «사실»이
-- 애초에 존재하게 만드는 상태다. 지금은 한 DB·한 트랜잭션이라 공짜로 성립하던 것들이라,
-- 소유권을 나누는 순간 저장할 자리 자체가 없다.
--
--   ① users.auth_generation  — 유저 축 세대(㊼). 탈퇴·전 기기 로그아웃에만 오른다.
--   ② auth_sessions          — 세션 축(㋣ · ㋞). 단일 refresh_token_hash 로는 «개별 기기 로그아웃»을
--                              표현할 수 없다 — B 로그인이 A 를 무효화하고 한 기기 로그아웃이 전
--                              세션을 지운다.
--   ③ group_members.*        — 멤버십 세대·전이 순서·표시정보 버전(ⓚ · ⓑ″ · ㋥ · ㋡).
--   ④ invite_claim_intents   — claim 의도 내구 큐(㊄ · ㊺). 202 를 줄 수 있는 «유일한» 근거다.
--   ⑤ invite_claim_confirmations — 멤버십 락 아래 남긴 확정 근거(㋟). 링크의 잠정 기록을 유효로 만든다.
--   ⑥ invite_click_migrations / invite_click_frozen_rows — 정지 스냅샷의 read-only export(§7.2 · ㋮).
--
-- ⚠️ 이 마이그레이션도 스키마만 만든다. 내부 HTTP 표면은 설정이 없으면 꺼져 있고(기본 disabled),
--    링크·알림 대상 전달은 V51 relay 가 꺼져 있는 동안 행으로만 쌓인다.

-- ── ① 유저 축 세대 ───────────────────────────────────────────────────
-- ㊼: 유저 공통 세대를 «개별 기기 로그아웃»에 올리면 로그인 중인 다른 기기의 onTokenRefresh 등록이
-- 거부돼 푸시가 끊긴다. 그래서 이 값이 오르는 사건은 «탈퇴»와 «전 기기 로그아웃» 둘뿐이다.
-- 기기 축(ownershipVersion)은 알림 서버가 소유하므로 여기 없다.
--
-- 기본값 0 으로 시작한다 — 구 AT 에는 gen claim 이 아예 없고(㊍), 「없음」을 현재 세대로 채우는 것은
-- tombstone 우회다. 0 은 «아직 한 번도 올린 적 없다»는 사실이지 「구 토큰의 세대」가 아니다.
ALTER TABLE public.users
    ADD COLUMN auth_generation bigint NOT NULL DEFAULT 0;

-- ── ② 세션 축 ────────────────────────────────────────────────────────
-- ㋣: RT 는 (userId, sessionId) 별 행이어야 한다. 현행 users.refresh_token_hash 단일 컬럼은 세션이
-- 하나뿐이라는 전제이고, 그 전제에서는 개별 로그아웃과 전 기기 로그아웃이 구별되지 않는다.
--
-- ㋪: 구 RT 에는 sessionId 가 없다. 그래서 이 테이블은 «병행»이다 — 기존 users.refresh_token_hash
-- 경로를 그대로 두고, 로그인·회전 때 세션 행을 함께 만든다. 곧장 전환하면 최대 RT 수명 동안
-- 구 토큰을 든 사용자가 전부 끊기고, 게스트에게 그것은 계정 소실이다.
CREATE TABLE public.auth_sessions (
    id                   uuid                        NOT NULL,
    user_id              uuid                        NOT NULL,
    -- 이 세션이 현재 인정하는 RT 의 해시. 회전 때 갈아끼운다.
    refresh_token_hash   character varying(64)       NOT NULL,
    -- ㋞ 세션 축의 자격(deviceBootstrap)의 해시. 원문은 저장하지 않는다 — 저장하면 DB 유출이 곧
    -- 「소유권 이전 자격 유출」이다. 앱이 아직 보내지 않는 값이라 NULL 을 허용한다(롤아웃).
    bootstrap_nonce_hash character varying(64),
    -- ㋨ fencing 값. 알림 서버가 자기 tombstone 과 원자 대조해 «이 값보다 오래된» 소유권 변경을
    -- 거부한다. 유저 축 aggregate 잠금 아래 발급되므로 번호 순서가 곧 커밋 순서다(㊸).
    session_epoch        bigint                      NOT NULL,
    -- 폐기 시각. 개별 로그아웃은 «이 행만», 전 기기 로그아웃·탈퇴는 유저의 모든 행.
    revoked_at           timestamp(6) with time zone,
    revoke_reason        character varying(30),
    -- 구 RT 를 백필한 행인가(㋪). 백필 행은 bootstrap nonce 가 없어 무토큰 이전 경로를 열 수 없다.
    legacy               boolean                     NOT NULL DEFAULT false,
    created_at           timestamp(6) with time zone NOT NULL,
    updated_at           timestamp(6) with time zone NOT NULL,
    CONSTRAINT auth_sessions_pkey PRIMARY KEY (id)
);

-- RT 해시로 세션을 찾는 것이 refresh·logout 의 유일한 진입이다. 두 세션이 같은 해시를 들면
-- 「어느 세션의 RT 인가」가 답이 없어진다.
CREATE UNIQUE INDEX uq_auth_sessions_refresh_token_hash
    ON public.auth_sessions (refresh_token_hash);

-- deviceBootstrap 검증 경로. 미설정 행이 대다수라 부분 인덱스로 좁힌다.
CREATE UNIQUE INDEX uq_auth_sessions_bootstrap_nonce_hash
    ON public.auth_sessions (bootstrap_nonce_hash)
    WHERE bootstrap_nonce_hash IS NOT NULL;

-- 「이 유저의 살아 있는 세션 전부」 — 전 기기 로그아웃·탈퇴가 매번 훑는다.
CREATE INDEX idx_auth_sessions_user_active
    ON public.auth_sessions (user_id)
    WHERE revoked_at IS NULL;

-- ── ③ 멤버십 세대·전이 순서·표시정보 버전 ────────────────────────────
-- ⓚ: GroupMember 에는 @Version 이 없고 조회가 무락이라, 판독 직후 커밋된 동시 탈퇴를 못 본다.
-- 그렇다고 일반 낙관락 version 을 쓰면 첫 수신자의 가입이 초대자 행의 version 을 올려
-- «재사용 링크의 이후 수신자가 전부 실패»한다. 그래서 탈퇴·강퇴·재가입에만 오르는 별도 세대를 둔다.
--
-- transition_seq 는 (groupId, inviterId) 축의 «커밋 순서»다(㋥). 같은 outbox 라도 HTTP 적용 순서는
-- 보장되지 않고, V51 의 유저 축 직렬화는 claim 사용자와 발급자가 다른 이 축을 덮지 못한다.
--
-- snapshot_version 은 표시정보(그룹명·발급자 닉네임) 스냅샷의 버전이다(㋡). 현행 resolveLanding 은
-- «열 때마다» 현재 이름을 조회하므로, 스냅샷 고정만 하고 갱신 경로가 없으면 공유된 slug 가
-- 만료까지 옛 이름을 노출한다. 늦게 온 이름 변경 relay 가 최신 이름을 덮지 않게 대조에 쓴다.
ALTER TABLE public.group_members
    ADD COLUMN membership_epoch bigint NOT NULL DEFAULT 1,
    ADD COLUMN transition_seq   bigint NOT NULL DEFAULT 0,
    ADD COLUMN snapshot_version bigint NOT NULL DEFAULT 0;

-- ── ④ claim 의도 내구 큐 ─────────────────────────────────────────────
-- ㊄ · ㊺: 정지 창의 claim 은 «거절이 아니라 대기»다 — 앱은 전역 15초 뒤 다음 로그인까지 재시도하지
-- 않는다(claimStoredInviteAttribution). 그래서 202 를 주려면 그 전에 의도가 내구 커밋돼 있어야 한다.
--
-- ⚠️ 이 큐는 outbox 행이 «아니다». outbox 봉투는 전달 대상이 하나 이상이어야 하는데(유실과 구분되지
-- 않으므로) claim 의도는 위성으로 나가는 명령이 아니다 — Data 가 링크에 claim 을 만들라고 HTTP 로
-- 부르는 것은 정본 방향(§3)과 ㋟(확정 순서는 Data 가 갖는다)를 동시에 어긴다. 그래서 Data 소유
-- 상태로 두고, 재개는 Business 가 이 큐를 읽어 링크 → Data confirm 순서를 다시 밟는다.
CREATE TABLE public.invite_claim_intents (
    id          uuid                        NOT NULL,
    user_id     uuid                        NOT NULL,
    -- 사건 키에는 들어가지 않고 «대조»에만 쓴다(아래 event_id 주석). 확정이 대기 의도를 닫을 때
    -- 고르는 축이기도 하다 — 실제 claim 은 (유저, 링크) 당 하나라, 확정 하나가 그 조합의 대기 의도를
    -- 전부 끝낸다.
    slug        character varying(12)       NOT NULL,
    -- PENDING(대기) · CONSUMED(확정까지 끝남) · ABANDONED(정본 판정으로 더 밟을 것이 없음)
    status      character varying(20)       NOT NULL
        CONSTRAINT invite_claim_intents_status_check
            CHECK ((status)::text = ANY ((ARRAY[
                'PENDING'::character varying,
                'CONSUMED'::character varying,
                'ABANDONED'::character varying])::text[])),
    -- 결정적 사건 키 — link.claimIntent:<user_id>:<SHA-256(정규화된 멱등 키)> 다(17+36+1+64=118자라
    -- 상한 200 안이고, 새 컬럼도 확장도 필요 없다). 같은 «요청 키»의 재시도가 새 행을 만들지 않게 한다.
    --
    -- ⚠️ slug 는 키에 «들어가지 않는다». (유저, slug) 를 키로 잡으면 그 조합이 한 번 종결된 뒤에는
    -- 새 의도가 영영 생기지 않는다 — 클릭 귀속이 뒤늦게 잡혀 같은 slug 를 다시 claim 하는 정상 경로가
    -- 종결된 행을 그대로 재생받고, 재개 sweep 은 status='PENDING' 만 보므로 그 뒤의 202 는 아무도
    -- 이어받지 않는 거짓 약속이 된다(귀속 유실). 대신 같은 키로 다른 slug 가 오면 그건 재시도가 아니라
    -- 키를 재사용한 별개 명령이라, 아래 slug 와 대조해 409(IDEMPOTENCY_KEY_CONFLICT)로 거절한다.
    event_id    character varying(200)      NOT NULL,
    -- 재개 실행자가 «같은 멱등 키»로 링크 pending·Data confirm 을 재생하기 위해 보관한다(㉼).
    -- 새 키를 만들면 재개가 중복 명령이 되어, 이미 확정된 귀속을 한 번 더 집계한다.
    idempotency_key character varying(200)  NOT NULL,
    -- 유저 축 aggregate 잠금 아래 발급된 값. 응답 봉투의 version 이다(㉵).
    version     bigint                      NOT NULL,
    -- 재개 주체가 한 번에 하나만 집도록 하는 선점 리스. lease_token 이 펜싱 토큰이다 —
    -- 리스가 만료돼 남이 재클레임한 뒤 옛 실행자가 뒤늦게 완료를 보고하면 토큰이 달라 0행이 된다.
    -- ⚠️ Data 에는 이 큐를 «실행하는» 워커가 없다. 링크 조회·claim 실행은 단방향 규칙(§3) 위반이라,
    --    재개는 Business 쪽 일회성 실행이 이 상태를 집어 간다. 여기 있는 것은 «상태»뿐이다.
    lease_owner     character varying(80),
    lease_token     uuid,
    lease_expires_at timestamp(6) with time zone,
    attempt_count   integer                  NOT NULL DEFAULT 0,
    next_attempt_at timestamp(6) with time zone NOT NULL,
    last_error      text,
    -- 어느 리스가 이 의도를 끝냈는가. 같은 토큰의 재보고는 200(멱등), 다른·낡은 토큰은 409 다 —
    -- 이 값이 없으면 「리스를 잃은 실행자의 뒤늦은 완료」와 「정상 재시도」를 구분할 수 없다.
    completed_by_lease_token uuid,
    created_at  timestamp(6) with time zone NOT NULL,
    updated_at  timestamp(6) with time zone NOT NULL,
    consumed_at timestamp(6) with time zone,
    CONSTRAINT invite_claim_intents_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uq_invite_claim_intents_event_id
    ON public.invite_claim_intents (event_id);

-- 재개 스캔 — 대기 중인 것만 본다. 커서는 created_at 이 아니라 «id»(UUID v7, 시간 정렬)로 잡는다.
CREATE INDEX idx_invite_claim_intents_pending
    ON public.invite_claim_intents (id)
    WHERE status = 'PENDING';

-- 「지금 집을 수 있는 것」 — 리스가 없거나 만료됐고 백오프가 지난 행.
CREATE INDEX idx_invite_claim_intents_claimable
    ON public.invite_claim_intents (next_attempt_at, lease_expires_at)
    WHERE status = 'PENDING';

-- ── ⑤ claim 확정 근거 ────────────────────────────────────────────────
-- ㋟: claimSeq 는 «판정 순서»일 뿐 링크 기록 순서가 아니다. 그래서 링크의 기록은 잠정이고,
-- Data 가 «멤버십 락 아래» 남긴 이 행이 와야 유효해진다. 전달은 link.claimConfirmed outbox 다 —
-- 락을 잡은 채 직접 호출은 §3 위반이고, 락이 풀린 뒤 Business 가 보내면 그 사이 revoke 가 끼어든다.
CREATE TABLE public.invite_claim_confirmations (
    -- 확정 근거의 식별자 = payload 의 proof.confirmationId.
    id               uuid                        NOT NULL,
    -- 링크 서버가 만든 잠정 claim 의 id. 같은 claim 이 두 번 확정되지 않게 UNIQUE 다.
    claim_id         uuid                        NOT NULL,
    user_id          uuid                        NOT NULL,
    group_id         uuid                        NOT NULL,
    inviter_id       uuid                        NOT NULL,
    slug             character varying(12)       NOT NULL,
    -- 확정 «시점»의 멤버십 세대·전이 순서. 링크 서버가 역순·구세대 명령을 거르는 기준이다.
    membership_epoch bigint                      NOT NULL,
    transition_seq   bigint                      NOT NULL,
    -- 같은 claim 이 «다른 멱등 키»로 다시 확정 요청될 때 재생할 봉투. 멱등 키는 앱 소유라 재개
    -- 실행자와 원 요청이 서로 다른 키를 들 수 있는데, 그때 claim 단위로도 한 번만 확정돼야 한다.
    event_id         character varying(200)      NOT NULL,
    version          bigint                      NOT NULL,
    committed_at     timestamp(6) with time zone NOT NULL,
    CONSTRAINT invite_claim_confirmations_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uq_invite_claim_confirmations_claim_id
    ON public.invite_claim_confirmations (claim_id);

-- ── ⑥ 클릭 이관 정지 스냅샷 ──────────────────────────────────────────
-- §7.2 · ㊥ · ㋮: 정지 창에도 «쓰기 원장은 Neon 하나»다. 구 DB 는 후보 «조회»만 하고, 양쪽에서
-- 소진하면 잠금이 공유되지 않아 같은 클릭이 두 기기에 배정된다. 그래서 여기는 read-only 스냅샷이고
-- 소진 상태 컬럼을 두지 않는다 — 소진은 Neon 이 (migrationId, clickId) 표시로 기록한다.
--
-- ㋖: 시각 기반 증분 커서를 쓰지 않는다. 상태 변경 시각은 커밋 순서를 보장하지 않아 늦게 커밋된
-- 전이를 영구히 건너뛴다. 그래서 «정지 후 전체 스냅샷»이다.
CREATE TABLE public.invite_click_migrations (
    migration_id character varying(80)       NOT NULL,
    -- FROZEN(스냅샷 확정, export 가능) · IMPORT_CLOSED(importer 쓰기 차단, 직접 쓰기 개방 전)
    status       character varying(20)       NOT NULL
        CONSTRAINT invite_click_migrations_status_check
            CHECK ((status)::text = ANY ((ARRAY[
                'FROZEN'::character varying,
                'IMPORT_CLOSED'::character varying])::text[])),
    frozen_at    timestamp(6) with time zone NOT NULL,
    closed_at    timestamp(6) with time zone,
    -- ── manifest ────────────────────────────────────────────────────
    -- 링크 서버의 최종 검증은 「기대 건수 + manifest 체크섬」이 있어야 닫힌다. 그 값은 스냅샷을 뜬
    -- «그 순간»의 사실이므로 여기서 함께 확정한다 — 나중에 다시 계산하면 그 사이 들어온 행이 섞인다.
    row_count       integer                  NOT NULL,
    source_checksum character varying(64)    NOT NULL,
    link_count      integer                  NOT NULL,
    link_checksum   character varying(64)    NOT NULL,
    CONSTRAINT invite_click_migrations_pkey PRIMARY KEY (migration_id)
);

CREATE TABLE public.invite_click_frozen_rows (
    migration_id      character varying(80)       NOT NULL,
    -- 구 DB 의 클릭 PK. Neon 의 유일성 키가 된다.
    click_id          uuid                        NOT NULL,
    -- ── 후보 조회 축 ─────────────────────────────────────────────────
    -- 아래 다섯은 frozen_source 안에도 있지만 «조회 조건»이라 컬럼으로도 둔다. jsonb 안을 훑어
    -- 3시간 창을 자르면 정지 창 동안 매 요청이 전체 스캔이 된다.
    slug              character varying(12)       NOT NULL,
    group_id          uuid                        NOT NULL,
    -- ⓕ: SHA-256(UTF8(ip + 기존 salt)) 그대로다. salt 를 새로 만들면 매치가 전멸한다.
    ip_hash           character varying(64)       NOT NULL,
    os                character varying(16)       NOT NULL,
    clicked_at        timestamp(6) with time zone NOT NULL,
    matched           boolean                     NOT NULL,
    -- ── 이관 원본 ────────────────────────────────────────────────────
    -- 링크 서버 importer 가 받는 «정규화된 원본 그대로»다(링크 migration.ts 의 FrozenClick 24필드).
    -- 컬럼으로 펴지 않는 이유: 그쪽 정규화 규칙(타임스탬프 ms 절삭 · 세대 문자열화 · null 허용)이
    -- 체크섬의 일부라, 펴 두면 조립 순서 하나가 어긋나도 체크섬이 달라지고 그 사실이
    -- 이관 당일에야 드러난다. 저장된 값이 곧 체크섬의 입력이다.
    frozen_source     jsonb                       NOT NULL,
    -- ㋮ 4단계 검증의 기준. 표시가 있는 행은 「원본 체크섬 + 불변 필드 일치」로 검증하므로
    -- 이 값이 빠지면 검증을 닫을 수 없다.
    source_checksum   character varying(64)       NOT NULL,
    CONSTRAINT invite_click_frozen_rows_pkey PRIMARY KEY (migration_id, click_id)
);

-- 호환 매치의 후보 조회 축 — (ipHash, os) 로 좁히고 3시간 창은 clicked_at 으로 자른다.
CREATE INDEX idx_invite_click_frozen_rows_lookup
    ON public.invite_click_frozen_rows (migration_id, ip_hash, os, clicked_at);

-- ── ⑦ 링크 정지 스냅샷 ───────────────────────────────────────────────
-- 클릭이 «한 번도 없던» slug 도 옮겨야 한다. 클릭에서 링크를 역산하면 그런 slug 가 통째로 빠지고,
-- 이미 공유된 초대가 전환 직후 실패한다(A22 ㊏: 링크 원장도 ④″ 대상이다).
--
-- 링크 서버의 FrozenLink 13필드를 그대로 담는다 — 클릭과 같은 이유로 jsonb 다(정규화 규칙이
-- 체크섬의 일부라, 컬럼으로 펴 두면 조립 순서 하나가 어긋나도 이관 당일에야 드러난다).
CREATE TABLE public.invite_link_frozen_rows (
    migration_id    character varying(80)       NOT NULL,
    link_id         uuid                        NOT NULL,
    slug            character varying(12)       NOT NULL,
    group_id        uuid                        NOT NULL,
    inviter_id      uuid                        NOT NULL,
    frozen_source   jsonb                       NOT NULL,
    source_checksum character varying(64)       NOT NULL,
    CONSTRAINT invite_link_frozen_rows_pkey PRIMARY KEY (migration_id, link_id)
);
