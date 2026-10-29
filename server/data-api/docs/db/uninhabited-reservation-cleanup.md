# 기존 무인도 예약 정리 (2537)

새 망원경 조회는 `onboarding_islands`에 쓰지 않는다. 이전 버전이 만든 예약은 항해 중이거나 성공 종료 후 도착 API를 아직 호출하지 않았을 수 있으므로, 배포 마이그레이션에서 일괄 삭제하지 않는다. 모든 data-api 인스턴스가 새 버전으로 교체된 뒤 아래 절차를 수행한다.

1. `onboarding_islands`의 사용자·섬 ID, 섬 공개 여부·상태, 활성 주민 수, 그 섬을 목적지로 한 SEA 세션의 진행 상태와 `arrived`를 확인한다.
2. 진행 중(`ACTIVE`·`PAUSED`) SEA 세션 또는 `arrived = true`인 SEA 세션이 하나라도 있는 예약은 보존한다. 도착 API를 재시도할 수 있어야 한다. 활성 주민이 있거나 비공개 섬이 아닌 경우도 자동 정리 대상에서 제외하고 조사한다.
3. 나머지 미정착 예약만 한 트랜잭션에서 섬을 `ENDED`·`deleted_at` 묘비로 닫고 예약 행을 지운다. 실제 섬·지갑·건설 행은 하드 삭제하지 않는다(기존 탈퇴 정리와 같은 방식).
4. 정리 전후 예약 수와 닫힌 섬 수를 대조한다. 보존 대상은 이후 세션/도착 상태를 확인해 같은 절차를 반복한다.

정리 대상 확인 쿼리(읽기 전용):

```sql
SELECT oi.user_id, oi.island_id, i.status, i.is_private, i.deleted_at
FROM onboarding_islands oi
JOIN islands i ON i.id = oi.island_id
WHERE i.is_private = true
  AND NOT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = oi.island_id AND gm.is_left = false
  )
  AND NOT EXISTS (
    SELECT 1 FROM focus_session_details d
    WHERE d.island_id = oi.island_id AND d.kind = 'SEA'
      AND (d.lifecycle IN ('ACTIVE', 'PAUSED') OR d.arrived = true)
  );
```

정리 시에는 위 조회의 정확한 `user_id`·`island_id` 쌍을 승인된 대상 목록으로 고정하고, 같은 조건을 트랜잭션 안에서 다시 확인한 뒤 기존 탈퇴 경로의 `closePendingOfUser` → `deleteAllOfUser`에 해당하는 묘비·예약 삭제를 적용한다. 조건이 달라진 행은 건너뛴다.
