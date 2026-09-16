// 서버 screentime 도메인 DTO 미러 (com.oneorthree.phone.screentime.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// POST /screen-time — 매일 23:59 iOS가 당일 스크린타임 달성 여부를 전송(달성 여부는 iOS에서 계산).
export interface ScreenTimeRequest {
  screenTimeGoalAchieved: boolean;
  actualScreenTimeMinutes: number | null; // nullable — iOS 개발 완료 후 채워짐, 0 이상
  reportedAt: string; // Instant
  // 최종 보고(어제·밀린 과거분 마감)면 true, 오늘 중간 동기화면 false(GROMO-828).
  // 서버는 final에서만 목표 달성을 확정·저장하고 GROMO-395 알림을 발사한다 — 이때
  // screenTimeGoalAchieved(클라가 당시 목표·데이터로 계산한 값)를 그대로 신뢰한다.
  // interim(오늘)은 사용분만 갱신하고 달성 판정·알림을 건너뛴다(하루 끝나야 판정 가능).
  // 미전송 시 서버가 reportedAt 날짜(<오늘)로 final을 추론하나, 명시 전송이 안전하고 권장됨.
  isFinal: boolean;
}
