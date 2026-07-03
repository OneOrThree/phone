// 서버 auth 도메인 DTO 미러 (com.oneorthree.phone.auth.dto).
// 요청 DTO는 dto.rep, 응답 DTO는 dto.res 하위. 토큰(accessToken/refreshToken 등)은 모두 문자열(JWT).
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// POST /auth/google|line|instagram|facebook|kakao — 소셜 Access/Identity 토큰.
export interface SocialLoginRequest {
  token: string;
}

// POST /auth/apple — Apple 로그인 요청.
export interface AppleLoginRequest {
  identityToken: string;
  authorizationCode: string;
  fullName: string;
}

// POST /auth/refresh — Refresh Token으로 Access Token 재발급 요청.
export interface TokenRefreshRequest {
  refreshToken: string;
}

// POST /auth/logout — 무효화할 Refresh Token.
export interface LogoutRequest {
  refreshToken: string;
}

// 소셜 로그인 응답(구글/라인/인스타/페북/카카오/애플 공용).
export interface SocialLoginResponse {
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean; // record component boolean isNewUser → JSON 키 그대로 isNewUser
}

// 게스트 로그인 응답.
export interface GuestLoginResponse {
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean; // record component boolean isNewUser → JSON 키 그대로 isNewUser
}

// 토큰 갱신 응답 — RT는 갱신되지 않고 새 AT만 발급.
export interface TokenRefreshResponse {
  accessToken: string;
}
