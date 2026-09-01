package com.oneorthree.phone.auth.dto.req;

/**
 * 토큰 갱신 요청.
 *
 * @param refreshToken 클라이언트가 보관 중인 refresh 토큰. 서버는 서명·타입뿐 아니라
 *                     저장된 해시와의 일치까지 확인하므로, 다른 기기 로그인·로그아웃·탈퇴로
 *                     해시가 이미 교체됐다면 서명이 유효해도 거절된다
 */
public record TokenRefreshRequest(String refreshToken) {
}
