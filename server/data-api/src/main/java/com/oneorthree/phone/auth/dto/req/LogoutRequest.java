package com.oneorthree.phone.auth.dto.req;

/**
 * 로그아웃 요청 — 세션 폐기와 <b>기기 토큰 삭제</b>를 한 트랜잭션에 담는다 (A22 ㋗ · ㊲ · ㊿).
 *
 * <h2>왜 기기 토큰 값이 여기 실리는가</h2>
 * 앱은 토큰 {@code DELETE} 와 {@code /auth/logout} 을 <b>별개 요청</b>으로 보내고, 앞 요청은 AT 로
 * 인증한다. AT 가 이미 만료된 상태(로그아웃 직전이 그렇다)면 그 {@code DELETE} 는 401 이 되고,
 * 앱은 실패를 삼킨 뒤 로컬 인증을 지운다 — <b>아무도 재시도하지 않고 이전 계정 푸시가 그 기기로 계속
 * 간다</b>. 그래서 RT 로 인증되는 이 요청이 같은 트랜잭션에서 삭제 명령까지 남긴다(㋗: 기기 토큰
 * DELETE 를 AT 만으로 인증하지 않는다).
 *
 * <p>세 필드 모두 <b>없을 수 있다</b> — 구 앱은 {@code {refreshToken}} 만 보낸다. 없으면 세션만
 * 폐기하고, 그 기간의 토큰 삭제는 종전처럼 앱의 {@code DELETE} 경로에 맡긴다.
 *
 * @param refreshToken   무효화할 <b>refresh</b> 토큰. access 토큰을 보내면 타입 가드에 걸려 거절된다 —
 *                       탈취한 access 토큰으로 남의 세션을 끊지 못하게 하는 장치다
 * @param deviceToken    이 기기의 FCM 토큰(㊪). 없으면 삭제 명령을 계약대로 만들 수 없다
 * @param ownershipToken 앱이 보관 중인 CAS 값(㊚). 롤아웃 기간엔 없을 수 있다
 * @param idempotencyKey 앱이 재시도 간 보존하는 키(㉼). 없으면 서버가 이 세션·토큰에 고정된 키를
 *                       만든다 — 삭제는 같은 대상을 두 번 지워도 같은 결과라 그 도출이 안전하다
 *                       (㊞ 가 금지하는 것은 <b>생성</b> 명령의 본문 유래 키다)
 */
public record LogoutRequest(
        String refreshToken, String deviceToken, String ownershipToken, String idempotencyKey) {

    /**
     * 구 앱 형태 — 토큰만 보내는 요청을 그대로 받는다.
     *
     * @param refreshToken 무효화할 refresh 토큰
     */
    public LogoutRequest(String refreshToken) {
        this(refreshToken, null, null, null);
    }
}
