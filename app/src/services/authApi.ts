// auth 도메인 API 래퍼 (AuthController, base /api/v1).
// 로그인/갱신/로그아웃은 모두 로그인 전(pre-auth) 엔드포인트로 JWT가 필요 없다.
// 일관성을 위해 axios 인스턴스 api를 그대로 쓴다(토큰 있으면 붙어도 무해). axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  SocialLoginRequest,
  AppleLoginRequest,
  TokenRefreshRequest,
  LogoutRequest,
  SocialLoginResponse,
  GuestLoginResponse,
  TokenRefreshResponse,
} from '@/types/dto/auth';

// POST /api/v1/auth/google — 구글 id_token 검증 후 AT/RT 발급. (pre-auth)
export async function googleLogin(body: SocialLoginRequest): Promise<SocialLoginResponse> {
  const { data } = await api.post<SocialLoginResponse>('/api/v1/auth/google', body);
  return data;
}

// POST /api/v1/auth/line — 라인 Access Token 검증 후 AT/RT 발급. (pre-auth)
export async function lineLogin(body: SocialLoginRequest): Promise<SocialLoginResponse> {
  const { data } = await api.post<SocialLoginResponse>('/api/v1/auth/line', body);
  return data;
}

// POST /api/v1/auth/instagram — 인스타그램 Access Token 검증 후 AT/RT 발급. (pre-auth)
export async function instagramLogin(body: SocialLoginRequest): Promise<SocialLoginResponse> {
  const { data } = await api.post<SocialLoginResponse>('/api/v1/auth/instagram', body);
  return data;
}

// POST /api/v1/auth/facebook — 페이스북 Limited Login id_token 검증 후 AT/RT 발급. (pre-auth)
export async function facebookLogin(body: SocialLoginRequest): Promise<SocialLoginResponse> {
  const { data } = await api.post<SocialLoginResponse>('/api/v1/auth/facebook', body);
  return data;
}

// POST /api/v1/auth/kakao — 카카오 Access Token 검증 후 AT/RT 발급. (pre-auth)
export async function kakaoLogin(body: SocialLoginRequest): Promise<SocialLoginResponse> {
  const { data } = await api.post<SocialLoginResponse>('/api/v1/auth/kakao', body);
  return data;
}

// POST /api/v1/auth/apple — 애플 Identity Token 검증 후 AT/RT 발급. (pre-auth)
export async function appleLogin(body: AppleLoginRequest): Promise<SocialLoginResponse> {
  const { data } = await api.post<SocialLoginResponse>('/api/v1/auth/apple', body);
  return data;
}

// POST /api/v1/auth/guest — 소셜 계정 없이 임시 게스트 사용자 생성. (pre-auth)
export async function guestLogin(): Promise<GuestLoginResponse> {
  const { data } = await api.post<GuestLoginResponse>('/api/v1/auth/guest');
  return data;
}

// POST /api/v1/auth/refresh — Refresh Token으로 새 Access Token 발급. (pre-auth)
export async function refresh(body: TokenRefreshRequest): Promise<TokenRefreshResponse> {
  const { data } = await api.post<TokenRefreshResponse>('/api/v1/auth/refresh', body);
  return data;
}

// POST /api/v1/auth/logout — Refresh Token 무효화(응답 본문 없음). (pre-auth)
export async function logout(body: LogoutRequest): Promise<void> {
  await api.post<void>('/api/v1/auth/logout', body);
}
