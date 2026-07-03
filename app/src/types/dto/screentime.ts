// 서버 screentime 도메인 DTO 미러 (com.oneorthree.phone.screentime.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// POST /screen-time — 매일 23:59 iOS가 당일 스크린타임 달성 여부를 전송(달성 여부는 iOS에서 계산).
export interface ScreenTimeRequest {
  screenTimeGoalAchieved: boolean;
  actualScreenTimeMinutes: number | null; // nullable — iOS 개발 완료 후 채워짐, 0 이상
  reportedAt: string; // Instant
}
