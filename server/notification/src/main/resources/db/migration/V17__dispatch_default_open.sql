-- 신규 알림 저장소는 발송 게이트를 열린 상태로 시작한다. 기존 저장소의 명시적
-- 종료 상태는 보존한다. 아직 발송 자료가 없는, 한 번도 열지 않은 저장소만 연다.
ALTER TABLE dispatch_control ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE dispatch_control ALTER COLUMN ever_opened SET DEFAULT true;

UPDATE dispatch_control
SET enabled = true, ever_opened = true, updated_at = now()
WHERE id = 1
  AND ever_opened = false
  AND NOT EXISTS (SELECT 1 FROM commands)
  AND NOT EXISTS (SELECT 1 FROM inbound_events)
  AND NOT EXISTS (SELECT 1 FROM user_fences)
  AND NOT EXISTS (SELECT 1 FROM settings)
  AND NOT EXISTS (SELECT 1 FROM projections)
  AND NOT EXISTS (SELECT 1 FROM deliveries)
  AND NOT EXISTS (SELECT 1 FROM device_tokens);
