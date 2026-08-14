-- ════════════════════════════════════════════════════════════════════
-- V49 — 결과 확인 표시(ack) + 표시 선점(lease) (GROMO-1577 · policy N58·B17·S16)
-- ════════════════════════════════════════════════════════════════════
-- 결과 모달 "1회 노출 가드"의 정본을 앱 로컬 마커에서 서버로 옮긴다(N58). 로컬 단독 가드는
-- 기기 교체·앱 재설치에서 최근 30일 결과 큐가 통째로 재생된다("이미 본 결과"를 다시 축하한다).
--
--   acknowledged_at     — 확인 표시. 리그 league_weekly_results.acknowledged_at 과 같은 모양이고
--                         acknowledged_at IS NULL 조건부 원자 UPDATE 로만 세팅된다(멱등·선점).
--   display_claimed_at  — 표시 선점(lease) 시각. 만료 판정의 기준축이며 ack 시 NULL 로 되돌린다.
--   display_claim_token — 선점 토큰(버전). 앱이 렌더 직전에 자기 선점이 아직 유효한지 대조하고,
--                         ack 은 이 토큰이 일치할 때만 성사된다(만료 후 재선점된 기기의 ack 차단).
--
-- 확인(ack)과 선점(claim)은 다른 상태다(IA §4.3) — 하나로 합치면 "노출 먼저"는 두 기기가 함께
-- 뜨고, "ack 먼저"는 렌더가 중단됐을 때 어느 기기에서도 못 보게 된다.

ALTER TABLE public.group_challenge_bet_participants
    ADD COLUMN acknowledged_at     timestamp with time zone,
    ADD COLUMN display_claimed_at  timestamp with time zone,
    ADD COLUMN display_claim_token uuid;

-- ── 기존 행 백필 (계약 V4) ───────────────────────────────────────────
-- 단순 nullable 로만 배포하면 배포 시각 이전의 결과가 전부 "미확인"이 되어, 재설치·새 기기
-- 사용자가 이미 본 결과를 최대 10건 다시 본다 — N58 이 막으려던 재생이 배포 직후 그대로 난다.
-- 그래서 배포 시각 이전에 이미 존재하던 결과는 확인된 것으로 본다.
--
-- ⚠️ 대상은 "이미 결과가 된 행"뿐이다 — 회차 status 가 결과 4종(SETTLED·FORFEITED·VOIDED·
-- REFUNDED)인 참가 행만 백필한다. OPEN 회차의 참가 행까지 ack 로 칠하면 배포 시점에 진행 중이던
-- 회차가 나중에 정산됐을 때 그 결과를 어느 기기에서도 못 보게 된다(아직 아무도 못 본 결과를
-- 유실한다). 결과 조회(GET /me/challenge-results)가 싣는 집합과 정확히 같은 술어다.
--
-- ⚠️ 상태만으로는 "배포 이전"이라는 의도를 표현하지 못한다 — <b>시간 축</b>도 함께 좁힌다.
-- 롤링 배포 중 구 인스턴스의 정산 트랜잭션이 이 마이그레이션의 테이블 락보다 먼저 시작해
-- 대기 중인 DDL 보다 먼저 커밋되면, 마이그레이션 시작 이후 <b>처음 생긴 결과</b>도 상태 조건에
-- 걸린다. 그 행까지 칠하면 아래 알림 종결까지 함께 걸려 사용자는 그 결과를 모달로도 푸시로도
-- 영구히 못 받는다(OPEN 을 제외한 것과 같은 사고의 시간 축 판).
--   · 기준은 now() — Flyway 는 마이그레이션 1개를 <b>한 트랜잭션</b>으로 감싸므로 이 파일의 세
--     문장에서 now() 는 전부 같은 값(마이그레이션 시작 시각)이다. 세 술어가 같은 기준이어야
--     한쪽으로 새지 않는다.
--   · settled_at 이 비어 있는 행은 제외된다(비교가 NULL) — 결과 조회도 settled_at 하한으로 거르므로
--     애초에 큐에 없고, 안전한 방향(못 본 결과를 잃지 않는 쪽)이다.
UPDATE public.group_challenge_bet_participants p
SET acknowledged_at = now()
FROM public.group_challenge_bet_sessions s
WHERE p.session_id = s.id
  AND s.status IN ('SETTLED', 'FORFEITED', 'VOIDED', 'REFUNDED')
  AND s.settled_at < now();

-- ── 백필한 결과의 대기 중 결과 알림 종결 (GROMO-1577 · B17) ──────────
-- 위 백필은 "이미 본 것으로 친다"인데 그 회차의 BET_RESULT 푸시 클레임을 그대로 두면, 배포 직후
-- ① 남아 있던 PENDING·DEFERRED 가 그대로 발송되고 ② 48시간 재훑기가 새 클레임을 만든다 —
-- 큐에서 이미 숨겨진 회차의 푸시가 도착해 탭하면 결과 없이 그룹방만 열린다. 런타임 ack 이
-- tombstone 으로 막는 바로 그 증상이 배포 경로에 남는 것이라, 같은 처방을 여기서도 한다.
--
-- ⚠️ BET_VOID_REFUND 축은 건드리지 않는다 — 무효화 환불은 결과 모달과 별개의 통지 사건이다(N48).
--
-- INSERT 를 먼저, 종결을 나중에 한다(런타임과 같은 순서). 롤링 배포 중 구 인스턴스가 같은 키로
-- PENDING 을 만들 수 있는데, 순서를 뒤집으면 "종결 이후 · INSERT 이전"에 들어온 행이 그대로 살아
-- 남는다. 이 순서면 유니크 인덱스가 직렬화해 준다.

-- (1) tombstone — 결과 알림이 실제로 나갈 회차(kind = BET_RESULT)에만. 백필 대상 중
--     VOIDED·REFUNDED 는 kind 가 BET_VOID_REFUND 라 여기서 빠진다(쓸모없는 행을 쌓지 않는다).
--     slot_at 은 런타임과 같은 15분 내림(BetEventNotificationService.slotOf).
INSERT INTO public.notification_sent_logs
    (id, user_id, type, kind, subject_id, group_id, slot_at, status, claimed_at, sent_at)
SELECT gen_random_uuid(), p.user_id, 'BET_RESULT', 'BET_RESULT', p.session_id, s.group_id,
       to_timestamp(floor(extract(epoch FROM COALESCE(s.settled_at, now())) / 900) * 900),
       'SENT', now(), now()
FROM public.group_challenge_bet_participants p
JOIN public.group_challenge_bet_sessions s ON s.id = p.session_id
WHERE s.status IN ('SETTLED', 'FORFEITED')
  AND s.settled_at < now()   -- 백필과 같은 기준(마이그레이션 시작 시각) — 갈리면 한쪽으로 샌다
ON CONFLICT (user_id, kind, subject_id) DO NOTHING;

-- (2) 이미 있던 미발송 클레임 종결 — 대상 집합은 위 백필과 같다(결과 4종). 축은 BET_RESULT 하나뿐이라
--     VOIDED·REFUNDED 회차에 BET_RESULT 행이 남아 있는 이력만 함께 닫힌다.
UPDATE public.notification_sent_logs l
SET status = 'SENT', sent_at = now(), next_attempt_at = NULL
FROM public.group_challenge_bet_participants p
JOIN public.group_challenge_bet_sessions s ON s.id = p.session_id
WHERE l.user_id = p.user_id
  AND l.subject_id = p.session_id
  AND l.kind = 'BET_RESULT'
  AND l.status IN ('PENDING', 'DEFERRED')
  AND s.status IN ('SETTLED', 'FORFEITED', 'VOIDED', 'REFUNDED')
  AND s.settled_at < now();   -- 백필과 같은 기준 — 배포 이후 처음 생긴 결과의 푸시는 그대로 나가야 한다

-- 인덱스는 더하지 않는다 — claim·ack 은 (session_id, user_id) 유니크를,
-- 결과 조회는 V44 의 (user_id, session_id) 를 그대로 탄다. 새 컬럼은 어느 술어에서도 선두가
-- 아니고(유저당 참가 행은 수십~수백 행 규모라 잔여 필터가 싸다), 미확인 개수 배지도 같은
-- (user_id, …) 축의 부분 스캔이라 전용 인덱스가 값을 하지 못한다.
