-- 이관 경로(import·verify·open)가 «전부» 먼저 잠그는 공통 행. 잠금 순서를 한 줄로 못 박는다.
-- active_migration_id 는 «전역으로 활성인 이관 하나»를 묶어 둔다 — settings·device_tokens·deliveries 는
-- 이관들 사이에 공유되므로, 서로 다른 id 의 적재가 섞이면 한쪽의 최종 검사가 다른 쪽의 미검증 쓰기를
-- 포함한 채 통과한다. 같은 id 의 재개는 그대로 이어진다.
CREATE TABLE dispatch_control (
    id integer PRIMARY KEY CHECK(id=1),
    enabled boolean NOT NULL DEFAULT false,
    ever_opened boolean NOT NULL DEFAULT false,
    active_migration_id text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dispatch_control(id) VALUES(1);
CREATE TABLE commands (
    scope text NOT NULL, command_key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,command_key)
);
CREATE TABLE inbound_events (
    event_id text PRIMARY KEY, envelope jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_fences (
    user_id uuid PRIMARY KEY, auth_generation bigint NOT NULL DEFAULT 0, withdrawn boolean NOT NULL DEFAULT false
);
CREATE TABLE session_fences (
    bootstrap_hash text PRIMARY KEY, user_id uuid NOT NULL, epoch bigint NOT NULL, revoked boolean NOT NULL DEFAULT false,
    used boolean NOT NULL DEFAULT false
);
-- 구 앱 세션 축. 자격(deviceBootstrap)을 저장하지 않는 앱은 session_fences 에 키를 만들 수 없다 —
-- 그 앱의 AT 에 실린 «서명된 sid» 를 대신 키로 쓴다. 같은 표에 섞지 않는 이유는 키의 근거가 다르기
-- 때문이다: 저쪽은 앱이 제시한 1회용 자격, 이쪽은 서버가 서명해 내려 준 세션 id 다. 섞으면 「자격
-- 없이도 자격 있는 것과 같은 권한」이 조용히 성립한다.
CREATE TABLE legacy_session_fences (
    session_id uuid PRIMARY KEY, user_id uuid NOT NULL, epoch bigint NOT NULL,
    revoked boolean NOT NULL DEFAULT false, used boolean NOT NULL DEFAULT false
);
-- 한 행에 «세 축»이 함께 있다. 섞으면 한 축의 사고가 다른 축을 같이 닫는다.
--   ① ownership_token — 매 등록마다 회전하는 1회용 소유권. 낡은 CAS·낡은 삭제를 걸러 낸다(A22 ㊚).
--   ② device_key — «같은 기기»의 변하지 않는 신원. 전송 이력(delivery_devices)의 키다. 소유권이
--      회전해도 승인된 같은 기기의 재등록·토큰 회전에서는 그대로 이어진다 — 이 둘을 한 값으로 쓰면
--      앱 재시작 한 번이 「아직 못 받은 기기」를 만들어 같은 알림을 다시 보낸다.
--   ③ active / transport_invalid — 끊는 이유가 다르다. active=false 는 «소유권 폐기»(로그아웃 ·
--      삭제 · 탈퇴 · 세션 폐기)라 되살아나면 안 되는 tombstone 이고, transport_invalid 는 FCM 이
--      그 토큰을 UNREGISTERED 로 돌려준 «전송 자격 상실»이다. 후자를 active 로 적으면 정상 세션의
--      토큰 교체가 자기 소유권에 걸려(CAS 는 활성 행만 본다) 재로그인 전까지 푸시가 끊긴다.
CREATE TABLE device_tokens (
    device_token text PRIMARY KEY, user_id uuid NOT NULL, ownership_token uuid NOT NULL UNIQUE,
    device_key uuid NOT NULL DEFAULT gen_random_uuid(),
    ownership_version bigint NOT NULL DEFAULT 1, auth_generation bigint, bootstrap_hash text,
    session_epoch bigint, legacy_session_id uuid, active boolean NOT NULL DEFAULT true,
    transport_invalid boolean NOT NULL DEFAULT false, imported_by text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- imported_by 는 «이 행을 만든 것이 이관인가»다. 모양만으로는 알 수 없다 — sid 도 bootstrap 도 없는
-- 구 앱의 «최초» 등록이 만든 행은 이관이 만든 행과 컬럼 값이 한 글자도 다르지 않다
-- (bootstrap_hash·session_epoch·legacy_session_id NULL, ownership_version=1, active). 그 둘을 모양으로
-- 가르면 최종 스냅샷 정리가 방금 등록한 살아 있는 기기를 끈다. 라이브 등록은 이 값을 NULL 로 지운다.
CREATE INDEX device_tokens_user ON device_tokens(user_id) WHERE active;
-- 구 앱엔 ownership 이 없다. 회전·폐기가 「그 세션의 기기」를 찾는 유일한 길이 이 인덱스다.
CREATE INDEX device_tokens_legacy_session ON device_tokens(user_id, legacy_session_id) WHERE active;
-- imported_by 는 «이 행을 마지막으로 쓴 것이 이관인가»다. 라이브 명령이 쓰면 NULL 로 지워진다.
-- 있어야 하는 이유: 구 Data 의 UserService.updateNotificationSettings() 는 유저 aggregate version 을
-- 올리지 않는다. 그래서 백필 뒤 사용자가 구 앱에서 알림을 끄면 최종 export 는 «값만 다르고 version 은
-- 같은» 행으로 온다. version 단조 가드만으로는 그 opt-out 이 영영 적재되지 않아 검증이 닫힌 채 남는다.
-- 같은 version 에서도 «이관이 만든 행»이면 최종 스냅샷을 덮어쓰되, 라이브 쓰기가 닿은 행은 건드리지 않는다.
CREATE TABLE settings (
    user_id uuid PRIMARY KEY, version bigint NOT NULL DEFAULT 0, notification_enabled boolean NOT NULL DEFAULT true,
    sound_enabled boolean NOT NULL DEFAULT true, night_mode_enabled boolean NOT NULL DEFAULT false,
    night_start_time time, night_end_time time, imported_by text
);
CREATE TABLE projections (
    projection_type text NOT NULL, user_id uuid NOT NULL, subject_id text NOT NULL DEFAULT '',
    version bigint NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(projection_type,user_id,subject_id)
);
CREATE TABLE kinds (
    id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, silent boolean NOT NULL DEFAULT false,
    quiet_policy text NOT NULL DEFAULT 'DROP' CHECK(quiet_policy IN ('DROP','DEFER','BYPASS')),
    eligibility_required boolean NOT NULL DEFAULT false, cooldown_seconds integer NOT NULL DEFAULT 0
);
CREATE TABLE templates (
    id text PRIMARY KEY, kind text NOT NULL REFERENCES kinds(id), locale text NOT NULL,
    title text, body text NOT NULL, enabled boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 1,
    UNIQUE(kind,locale)
);
CREATE TABLE deeplinks (
    id text PRIMARY KEY REFERENCES kinds(id), url_template text, data_template jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE deliveries (
    id uuid PRIMARY KEY, event_id text NOT NULL UNIQUE, user_id uuid NOT NULL, kind text NOT NULL REFERENCES kinds(id),
    subject_id text, admin_actor text, replay_of uuid REFERENCES deliveries(id), group_id uuid, slot_at timestamptz, payload jsonb NOT NULL, locale text,
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DEFERRED','SENT','SUPPRESSED','FAILED')),
    next_attempt_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
    lease_token uuid, lease_expires_at timestamptz, sent_at timestamptz, last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_due ON deliveries(next_attempt_at) WHERE status IN ('PENDING','DEFERRED');
CREATE UNIQUE INDEX deliveries_subject ON deliveries(user_id,kind,subject_id) WHERE subject_id IS NOT NULL AND admin_actor IS NULL
    AND kind IN ('BET_RESULT','BET_VOID_REFUND','BET_WON','BET_SILENT_FLUSH',
                 'CHALLENGE_SESSION_OPEN','CHALLENGE_CREATED');
-- 「이 알림이 이 기기에 이미 갔는가」. 키는 소유권이 아니라 기기 신원이다 — 소유권은 등록마다
-- 회전하므로, 그것으로 적으면 부분 실패 재시도 사이에 앱을 재시작한 기기가 미전송으로 되돌아간다.
CREATE TABLE delivery_devices (
    delivery_id uuid NOT NULL REFERENCES deliveries(id), device_key uuid NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(delivery_id,device_key)
);
CREATE TABLE result_ack (
    user_id uuid NOT NULL, session_id uuid NOT NULL,
    state text NOT NULL CHECK(state IN ('HELD','NEEDS_CONFIRM','CONFIRMED','RELEASED')),
    held_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,session_id)
);
CREATE TABLE jobs (
    id text PRIMARY KEY, owner text NOT NULL CHECK(owner IN ('DATA','NOTIFICATION')), cron text NOT NULL,
    enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_runs (
    job_id text NOT NULL REFERENCES jobs(id), scheduled_at timestamptz NOT NULL,
    completed_at timestamptz, lease_expires_at timestamptz, error text, PRIMARY KEY(job_id,scheduled_at)
);
CREATE TABLE admin_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
    resource_id text, request jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- snapshot_id 는 «이 키가 마지막으로 실려 온 스냅샷»이다. 원장 행은 지우지 않는다 — 최종 스냅샷에서
-- 빠진 키(정산된 회차 · 탈퇴 유저)는 옛 태그를 단 채 남고, 지목된 스냅샷의 집계에서만 빠진다.
-- 제외를 «이번 배치에 없음»으로 추론하지 않기 위해 태그가 필요하다: 적재는 500건씩 쪼개 들어오므로
-- 배치 하나의 부재는 아무 뜻도 아니다. 빈 문자열은 스냅샷을 선언하지 않은 적재(단일 스냅샷 운용)다.
CREATE TABLE imports (
    migration_id text NOT NULL, record_key text NOT NULL, checksum text NOT NULL,
    record jsonb NOT NULL DEFAULT '{}'::jsonb, snapshot_id text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'IMPORTED' CHECK(status IN ('IMPORTED','SUPERSEDED','SKIPPED')),
    imported_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(migration_id,record_key)
);
CREATE INDEX imports_snapshot ON imports(migration_id,snapshot_id,record_key);
-- 선언된 스냅샷의 등재부. 레코드 «0건»으로 선언한 스냅샷도 여기 남는다 — 그래야 「전량 제거된
-- 정당한 최종 스냅샷」과 「태그를 빠뜨려 아무것도 안 실린 스냅샷」을 구분할 수 있다. 전자는 통과해야
-- 하고 후자는 막아야 하는데, 구성원 건수만으로는 둘이 똑같이 0 이다.
CREATE TABLE migration_snapshots (
    migration_id text NOT NULL, snapshot_id text NOT NULL,
    registered_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(migration_id,snapshot_id)
);
CREATE TABLE migration_state (
    id text PRIMARY KEY, version bigint NOT NULL DEFAULT 0, manifest jsonb NOT NULL, verified_at timestamptz, opened_at timestamptz
);
