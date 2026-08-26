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

-- ── 백필 대상 고정 (계약 V4) — ⚠️ ALTER 보다 먼저 실행해야 한다 ─────────
-- 백필의 기준은 "언제 정산됐나"(타임스탬프)가 아니라 <b>"이 마이그레이션이 시작할 때 이미
-- 보였나"</b>(트랜잭션 가시성)다. 타임스탬프 비교(settled_at < now())로는 다음이 안 닫힌다:
--
--   ① 롤링 배포 중, V49 가 시작하기 <b>전에</b> 구 인스턴스의 정산 트랜잭션이 settled_at 을
--      이른 시각으로 찍는다(아직 미커밋).
--   ② V49 가 시작한다. ALTER TABLE 이 ACCESS EXCLUSIVE 락을 잡으려 그 트랜잭션을 기다린다
--      (정산은 참가 행도 함께 갱신하므로 실제로 이 테이블에서 막힌다).
--   ③ 정산이 커밋되고 ALTER 가 진행된다.
--   ④ 뒤이은 문장의 스냅샷은 <b>문장 시작 시점</b>(READ COMMITTED)이라 방금 커밋된 그 행이 보이고,
--      settled_at 은 ①에서 찍힌 이른 시각이라 시각 비교를 통과한다 → 백필된다.
--   ⑤ 아래 tombstone 이 푸시까지 막는다 → <b>한 번도 공개되지 않은 결과를 모달·푸시 양쪽에서
--      영구히 잃는다.</b>
--
-- 그래서 <b>ALTER(=락 대기) 전에</b> 대상 집합을 한 번 떠서 고정한다. 이 SELECT 는 락을 기다리지
-- 않고 그 순간의 스냅샷을 보므로, <b>아직 커밋되지 않은 정산은 애초에 보이지 않는다</b>. 이후 세
-- 문장이 전부 이 고정 집합만 보므로 술어가 하나로 통일되고(갈릴 여지가 없다) 위 시나리오가 닫힌다.
--
-- settled_at 시각 비교는 <b>더 쓰지 않는다</b> — 기준이 시각이 아니라 가시성이라는 것을 코드가
-- 그대로 말해야 한다(시각 술어를 남겨 두면 다음 사람이 그쪽을 기준으로 착각한다). 인스턴스 시계가
-- 앞서 미래 시각으로 찍힌 결과라도, <b>이미 커밋돼 조회에 실린다면</b> 사용자가 볼 수 있었으므로
-- 확인 처리가 맞다.
CREATE TEMP TABLE v49_backfill_targets AS
SELECT p.id       AS participant_id,
       p.user_id  AS user_id,
       s.id       AS session_id,
       s.group_id AS group_id,
       s.status   AS session_status,
       s.settled_at
FROM public.group_challenge_bet_participants p
JOIN public.group_challenge_bet_sessions s ON s.id = p.session_id
WHERE s.status IN ('SETTLED', 'FORFEITED', 'VOIDED', 'REFUNDED');

ALTER TABLE public.group_challenge_bet_participants
    ADD COLUMN acknowledged_at     timestamp with time zone,
    ADD COLUMN display_claimed_at  timestamp with time zone,
    ADD COLUMN display_claim_token uuid;

-- ── 기존 행 백필 (계약 V4) ───────────────────────────────────────────
-- 단순 nullable 로만 배포하면 배포 시각 이전의 결과가 전부 "미확인"이 되어, 재설치·새 기기
-- 사용자가 이미 본 결과를 최대 10건 다시 본다 — N58 이 막으려던 재생이 배포 직후 그대로 난다.
--
-- ⚠️ 대상은 "이미 결과가 된 행"뿐이다 — 고정 집합이 결과 4종(SETTLED·FORFEITED·VOIDED·REFUNDED)만
-- 담는다. OPEN 회차의 참가 행까지 ack 로 칠하면 배포 시점에 진행 중이던 회차가 나중에 정산됐을 때
-- 그 결과를 어느 기기에서도 못 보게 된다(아직 아무도 못 본 결과를 유실한다). 결과 조회
-- (GET /me/challenge-results)가 싣는 집합과 정확히 같은 술어다.
--
-- 시각은 now() 로 찍는다 — Flyway 는 마이그레이션 1개를 <b>한 트랜잭션</b>으로 감싸므로 이 파일의
-- 모든 now() 가 같은 값(마이그레이션 시작 시각)이다. ⚠️ 여기서 clock_timestamp() 로 바꾸면 안 된다:
-- 고정되는 성질이 곧 요구사항이다. 반대로 런타임 선점
-- (GroupChallengeBetParticipantRepository)은 clock_timestamp() + 선잠금이 맞다 — 거기서는 행 잠금을
-- 기다린 뒤 실행돼 트랜잭션 시작 시각이 이미 낡아 있다. <b>두 선택은 서로 다른 이유로 각각 옳으니
-- 한쪽에 맞춰 통일하지 말 것.</b>
UPDATE public.group_challenge_bet_participants p
SET acknowledged_at = now()
FROM v49_backfill_targets t
WHERE p.id = t.participant_id;

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
SELECT gen_random_uuid(), t.user_id, 'BET_RESULT', 'BET_RESULT', t.session_id, t.group_id,
       to_timestamp(floor(extract(epoch FROM COALESCE(t.settled_at, now())) / 900) * 900),
       'SENT', now(), now()
FROM v49_backfill_targets t
WHERE t.session_status IN ('SETTLED', 'FORFEITED')
ON CONFLICT (user_id, kind, subject_id) DO NOTHING;

-- (2) 이미 있던 미발송 클레임 종결 — 대상 집합은 위 백필과 <b>같은 고정 집합</b>이다(결과 4종).
--     축은 BET_RESULT 하나뿐이라 VOIDED·REFUNDED 회차에 BET_RESULT 행이 남아 있는 이력만 함께 닫힌다.
UPDATE public.notification_sent_logs l
SET status = 'SENT', sent_at = now(), next_attempt_at = NULL
FROM v49_backfill_targets t
WHERE l.user_id = t.user_id
  AND l.subject_id = t.session_id
  AND l.kind = 'BET_RESULT'
  AND l.status IN ('PENDING', 'DEFERRED');

-- 고정 집합은 여기까지만 쓰인다. ON COMMIT DROP 을 쓰지 않는 이유: Flyway 가 이 마이그레이션을
-- 트랜잭션으로 감싸지 않는 설정에서는 생성 직후 사라져 뒤 문장이 통째로 빈 집합을 보게 된다.
DROP TABLE IF EXISTS v49_backfill_targets;

-- 인덱스는 더하지 않는다 — claim·ack 은 (session_id, user_id) 유니크를,
-- 결과 조회는 V44 의 (user_id, session_id) 를 그대로 탄다. 새 컬럼은 어느 술어에서도 선두가
-- 아니고(유저당 참가 행은 수십~수백 행 규모라 잔여 필터가 싸다), 미확인 개수 배지도 같은
-- (user_id, …) 축의 부분 스캔이라 전용 인덱스가 값을 하지 못한다.
