package com.oneorthree.business.upstream.notification.dto;

/**
 * 기기 토큰 등록 요청 봉투 — 세 축의 값을 <b>모두</b> 싣는다(A22 ㋞).
 *
 * <p>축이 셋인 이유: 유저 축({@code authGeneration}: 탈퇴·전 기기 로그아웃) · 기기 축
 * ({@code ownershipToken}: 같은 유저의 요청 순서) · 세션 축({@code deviceBootstrap} +
 * {@code sessionEpoch}: 그 로그인 세션이 살아 있는가). 하나라도 빠지면 막을 수 없는 경합이 남는다 —
 * 세대만으로는 유저 간 순서를 못 가리고(㊌), 소유권 토큰만으로는 미사용 nonce 의 지연 요청을 못 막고
 * (㋞), 동기 세션 확인 없이는 비동기 폐기 지연 구간이 샌다(㋤).
 *
 * @param deviceToken     FCM registration token — 행의 키다(토큰은 기기 단위 유일)
 * @param ownershipToken  앱이 보관 중인 CAS 값. <b>없을 수 있다</b> — 롤아웃 ②기간과 부트스트랩 예외(㊦)
 * @param deviceBootstrap 그 로그인 세션의 1회용 자격. 토큰 없는 «소유권 이전» 요청에 필요하다(㋚ ⓑ)
 * @param sessionEpoch    Data 의 동기 확인이 준 fencing 값. 알림 서버가 자기 tombstone 과 원자 대조한다(㋨).
 *                        RT 회전만으로도 커지므로 알림 서버의 멱등 비교 기준에선 <b>빠져 있다</b> —
 *                        같은 의도의 재시도가 키 충돌로 막히지 않게. 대신 재생 때도 이 값으로 다시 검증한다
 * @param authGeneration  AT 의 {@code gen} claim. <b>없으면 null</b> — 현재 세대로 채우면 tombstone 우회(㊍)
 */
public record DeviceRegistration(
        String deviceToken,
        String ownershipToken,
        String deviceBootstrap,
        Long sessionEpoch,
        Long authGeneration) {
}
