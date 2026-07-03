// 서버 health 도메인 DTO 미러 (com.oneorthree.phone.common.api.HealthController).
// GET /health 는 DTO가 아니라 평문 문자열(String)을 반환한다(예: "test").
// ⚠️ 백엔드 컨트롤러가 바뀌면 이 파일도 함께 갱신한다.

// GET /health — 서버 상태 확인. 백엔드가 String을 그대로 반환하므로 평문 문자열.
export type HealthResponse = string;
