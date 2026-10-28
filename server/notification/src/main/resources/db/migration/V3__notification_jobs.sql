CREATE TABLE shedlock (
    name varchar(64) PRIMARY KEY,
    lock_until timestamp NOT NULL,
    locked_at timestamp NOT NULL,
    locked_by varchar(255) NOT NULL
);
-- Data 정본 이관과 공통 발송 게이트 확인 후 Console 에서 각 잡을 활성화한다.
INSERT INTO jobs(id,owner,cron) VALUES
    ('bundle-flush','NOTIFICATION','0/5 * * * * *'),
    ('ack-reconcile','NOTIFICATION','0/5 * * * * *'),
    ('user-reconcile','NOTIFICATION','0 0 4 * * *');

-- 코어 조회가 필요한 잡은 Data 소유: Console 조회만 제공하며 여기서 실행하지 않는다.
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-league-weekly-results','DATA','0 0 7 * * MON','{"crons":["0 0 7 * * MON"],"replayable":true,"replayCliId":"LEAGUE_WEEKLY_RESULTS","target":"LeagueNotificationService#sendWeeklyResultNotifications(Instant)","note":"league_weekly_results 테이블을 읽는다 — 코어 조회라 Data 잔류."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-league-deadline','DATA','0 0 20 * * SUN','{"crons":["0 0 20 * * SUN"],"replayable":true,"replayCliId":"LEAGUE_DEADLINE","target":"LeagueNotificationService#sendDeadlineReminders(Instant)","note":"전역 랭킹 keyset 페이징 — 순위가 렌더 입력(rank)."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-league-sunday-crisis','DATA','0 0 9 * * SUN','{"crons":["0 0 9 * * SUN"],"replayable":true,"replayCliId":"LEAGUE_SUNDAY_CRISIS","target":"LeagueNotificationService#sendSundayCrisisReminders(Instant)","note":"**한 크론이 두 kind 를 낸다** — 유저당 1건 분기(강등 위험 > 마감 D-1 > 무발송)."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-league-relegation-warning','DATA','0 0 18 * * SUN','{"crons":["0 0 18 * * SUN"],"replayable":true,"replayCliId":"LEAGUE_RELEGATION_WARNING","target":"LeagueNotificationService#sendRelegationWarnings(Instant)","note":"09:00 과 «의도된 하루 2회» 발송이라 kind 를 갈랐다(같은 kind + DAY 축이면 저녁분이 접혀 사라진다)."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-league-final-deadline','DATA','0 0 22 * * SUN','{"crons":["0 0 22 * * SUN"],"replayable":true,"replayCliId":"LEAGUE_FINAL_DEADLINE","target":"LeagueNotificationService#sendFinalDeadlineReminders(Instant)","note":"LEAGUE_DEADLINE 과 문구는 비슷하나 딥링크가 다르다(focus vs league)."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-inactive-return','DATA','0 0 10 * * *','{"crons":["0 0 10 * * *"],"replayable":true,"replayCliId":"INACTIVE_RETURN","target":"InactiveReturnNotificationService#sendInactiveReturnNotifications(Instant)","note":"users.last_active_at 의 KST 날짜 diff — 「정확히 N일째」라 날이 바뀌면 단계가 달라진다."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-missed-focus-today','DATA','0 0 21 * * MON-FRI','{"crons":["0 0 21 * * MON-FRI"],"replayable":true,"replayCliId":"MISSED_FOCUS_TODAY","target":"LeagueReengagementNotificationService#sendMissedFocusToday(Instant)","note":"focus_sessions 완료/라이브 조회 — 코어 잔류."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-streak-at-risk','DATA','0 0 22 * * MON-SAT','{"crons":["0 0 22 * * MON-SAT","0 0 21 * * SUN"],"replayable":true,"replayCliId":"STREAK_AT_RISK","target":"LeagueReengagementNotificationService#sendStreakAtRisk(Instant)","note":"**@Scheduled 가 2개 붙은 유일한 메서드** — 일요일만 21:00 으로 오프셋(22:00 은 마감 2h 푸시와 겹친다)."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-bet-event-rescan','DATA','0 */15 * * * *','{"crons":["0 */15 * * * *"],"replayable":true,"replayCliId":"BET_EVENT_RESCAN","target":"BetEventNotificationService#rescanAndFlush(Instant)","note":"OUTBOX 모드에서는 «후보 -> outbox» 로만 끝난다(flush 없음). 자기 회복형이라 한 번 돌리면 48시간치를 회수한다."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-session-open','DATA','0 */15 * * * *','{"crons":["0 */15 * * * *"],"replayable":true,"replayCliId":"SESSION_OPEN","target":"SessionOpenNotificationService#sendSessionOpenNotifications(Instant)","note":"OUTBOX 모드에서는 선점/이월/묶음을 하지 않는다 — deferExpiresAt(참가 마감)만 실어 보낸다."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-challenge-window-end','DATA','0 */15 * * * *','{"crons":["0 */15 * * * *"],"replayable":true,"replayCliId":"CHALLENGE_WINDOW_END","target":"ChallengeWindowEndNotificationService#sendWindowEndNotifications(Instant)","note":"창 종료 감지는 시각 고정 크론으로 못 잡는다(창이 매일 다르다)."}'::jsonb);
INSERT INTO jobs(id,owner,cron,config) VALUES('notification-challenge-duration-end','DATA','0 0 9 * * *','{"crons":["0 0 9 * * *"],"replayable":true,"replayCliId":"CHALLENGE_DURATION_END","target":"ChallengeDurationEndNotificationService#sendDurationEndNotifications(Instant)","note":"kind 이름이 CHALLENGE_ENDED 인 것은 앱 레거시 딥링크 폴백 때문이다."}'::jsonb);
