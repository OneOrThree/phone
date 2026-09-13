package com.oneorthree.phone.auth.dto.req;

import com.oneorthree.phone.common.support.DeviceOwnershipTokens;

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
     * <p>세 필드 모두 <b>없을 수 있다</b> — 구 앱은 {@code {refreshToken}} 만 보낸다. 구 단일 RT에
     * 연결한 이관 기기는 이 요청만으로 삭제를 기록한다. 이미 새 세션·bootstrap에 연결된 기기는
     * 세션 폐기로 정리하며, 다른 세션의 토큰을 현재 유저 단일 값에서 추정하지 않는다.
 *
 * @param refreshToken   무효화할 <b>refresh</b> 토큰. access 토큰을 보내면 타입 가드에 걸려 거절된다 —
 *                       탈취한 access 토큰으로 남의 세션을 끊지 못하게 하는 장치다
     * @param deviceToken    이 기기의 FCM 토큰(㊪). 없으면 검증된 구 세션의 이관 기기 또는 세션 폐기로 한정한다
 * @param ownershipToken 앱이 보관 중인 CAS 값(㊚). 롤아웃 기간엔 없을 수 있다. <b>있으면</b> 정규
 *                       UUID 표기여야 한다 — 이 값은 같은 트랜잭션의 outbox 봉투에 그대로 실려
 *                       영구 보관되므로, 형식 검사가 <b>내구 기록보다 앞</b>이어야 한다
 * @param idempotencyKey 앱이 재시도 간 보존하는 키(㉼). 없으면 서버가 이 세션·토큰에 고정된 키를
 *                       만든다 — 삭제는 같은 대상을 두 번 지워도 같은 결과라 그 도출이 안전하다
 *                       (㊞ 가 금지하는 것은 <b>생성</b> 명령의 본문 유래 키다)
 */
public record LogoutRequest(
        String refreshToken, String deviceToken, String ownershipToken, String idempotencyKey) {

    /**
     * 소유권 값의 형식을 <b>역직렬화 시점</b>에 본다 — 로그아웃 트랜잭션이 열리기도 전이다.
     *
     * <p>여기서 막는 이유는 이 요청이 {@code /auth/logout} 한 번으로 세션 폐기와 기기 토큰 삭제
     * <b>내구 기록</b>을 함께 커밋하기 때문이다(㋗ · ㊲). 정규 표기가 아닌 CAS 값이 봉투에 실리면
     * 알림 서버가 그 봉투를 소비하지 못하고, relay 는 고갈 처리가 없어(A18) 순서 축이 같은
     * <b>그 유저의 뒤 이벤트가 전부</b> 막힌다.
     *
     * <p><b>{@code null} 로 접지 않는다.</b> {@code null} 은 「CAS 검사 없음」이라는 다른 뜻이라,
     * 그 뜻으로 접으면 지연된 로그아웃이 그 사이 재등록된 지금 기기까지 지운다(㊚). 형식이 깨진
     * 값은 <b>어느 행에도 맞지 않는 소유권</b>이지 「소유권 없음」이 아니다.
     *
     * <p>거절은 400 이고, 앱은 이 값을 빼거나 고쳐 다시 보낼 수 있다 — 값을 싣지 않는 형태
     * ({@code {refreshToken}} 만)는 종전대로 받는다. 실제 앱은 서버가 돌려준 값만 저장했다가
     * 문자열일 때만 싣는다({@code notificationCommands.ts:325-329}).
     */
    public LogoutRequest {
        if (!DeviceOwnershipTokens.isCanonicalOrAbsent(ownershipToken)) {
            throw new IllegalArgumentException("ownershipToken 은 정규 UUID 표기여야 합니다.");
        }
    }

    /**
     * 구 앱 형태 — 토큰만 보내는 요청을 그대로 받는다.
     *
     * @param refreshToken 무효화할 refresh 토큰
     */
    public LogoutRequest(String refreshToken) {
        this(refreshToken, null, null, null);
    }
}
