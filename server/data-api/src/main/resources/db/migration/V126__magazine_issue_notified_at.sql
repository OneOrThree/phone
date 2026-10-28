-- GROMO-2307 07시 잡지 발행 알림 — 알림 펼치기가 끝난 호를 표시한다.
--
-- 호 생성(MagazinePublishService)과 알림 펼치기(MagazineIssueNotifier)는 한 트랜잭션이 아니다 — 호가 커밋된 뒤
-- 펼치다 죽으면 «그날 첫 호출만 호를 돌려준다» 는 발행 멱등성 때문에 다음 틱이 그 호를 다시 알릴 방법이 없었다.
-- notified_at 이 NULL 인 호는 틱마다(10분) 이어서 펼친다. 중복은 알림 결정적 키(OUTBOX)와
-- notification_sent_logs (user_id, kind, subject_id=호 id) 선점(LEGACY)이 접는다.
-- 이미 발행된 호(dev 데이터)는 NULL 로 남아 다음 틱에 한 번 펼쳐진다 — 잡지 발행 스위치(magazine.enabled)가 꺼진
-- 환경에는 호가 없어 아무 일도 없다.
ALTER TABLE magazine_issues ADD COLUMN notified_at timestamptz;
COMMENT ON COLUMN magazine_issues.notified_at IS '알림 펼치기 완료 시각 — NULL 이면 틱마다 재시도(GROMO-2307)';
