-- 현재 지원하는 친구·섬·잡지 알림 외에는 신규 발송하지 않는다. 기존 발송 이력은 보존한다.
UPDATE kinds SET enabled=false WHERE id NOT IN ('FRIEND_REQUEST','FRIEND_ACCEPTED','MAIN_ISLAND_TRANSFERRED','MAGAZINE_PUBLISHED','ISLAND_KICKED');
UPDATE templates SET enabled=false WHERE kind NOT IN ('FRIEND_REQUEST','FRIEND_ACCEPTED','MAIN_ISLAND_TRANSFERRED','MAGAZINE_PUBLISHED','ISLAND_KICKED');
UPDATE deliveries SET status='SUPPRESSED',last_error='RETIRED_NOTIFICATION_KIND',
    lease_token=NULL,lease_expires_at=NULL
WHERE kind NOT IN ('FRIEND_REQUEST','FRIEND_ACCEPTED','MAIN_ISLAND_TRANSFERRED','MAGAZINE_PUBLISHED','ISLAND_KICKED')
    AND status IN ('PENDING','DEFERRED');

-- 현행 발송 잡의 활성 여부와 크론은 그대로 승계한다.
INSERT INTO jobs(id,owner,cron,enabled,config,updated_at)
SELECT 'delivery-dispatch',owner,cron,enabled,config,updated_at FROM jobs WHERE id='bundle-flush';
UPDATE job_runs SET job_id='delivery-dispatch' WHERE job_id='bundle-flush';
DELETE FROM job_runs WHERE job_id NOT IN ('delivery-dispatch','user-reconcile');
DELETE FROM jobs WHERE id NOT IN ('delivery-dispatch','user-reconcile');

-- Data의 옛 결과 확인·묶음 완료 및 정지 스냅샷 반입 전용 저장소를 폐기한다.
DROP TABLE result_ack;
DROP TABLE result_bundle_manifests;
DROP TABLE imports;
DROP TABLE migration_snapshots;
DROP TABLE migration_state;
ALTER TABLE dispatch_control DROP COLUMN active_migration_id;
ALTER TABLE settings DROP COLUMN imported_by;
ALTER TABLE device_tokens DROP COLUMN imported_by;
DELETE FROM projections WHERE projection_type NOT IN ('user.updated','user.snapshot','friend.request.resolved','user.displayNameChanged');
