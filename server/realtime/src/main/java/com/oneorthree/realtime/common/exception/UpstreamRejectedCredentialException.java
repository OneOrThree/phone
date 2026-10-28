package com.oneorthree.realtime.common.exception;

/**
 * 상류(Data API)가 <b>이 토큰</b>을 거절했다 — 401.
 *
 * <p><b>왜 「비멤버」와 갈라야 하나.</b> 둘 다 「이 방을 못 쓴다」로 끝나지만 <b>앱이 해야 할 일이
 * 정반대</b>다. {@code NOT_A_MEMBER} 는 「그 섬에서 나갔다」라 방 목록에서 지우는 것이 맞고,
 * {@code UNAUTHORIZED} 는 「토큰을 갱신하고 다시 붙어라」다. 401 을 비멤버로 접으면 앱은 갱신이
 * 필요하다는 것을 <b>알 길이 없어</b>, 다른 REST 요청이 우연히 갱신을 일으키거나 사용자가 앱을
 * 다시 켤 때까지 채팅이 「이 섬의 멤버가 아닙니다」로 막힌 채로 남는다.
 *
 * <p>이 상황은 드물지 않다 — STOMP 세션은 CONNECT 때 받은 토큰을 그대로 들고 오래 산다
 * ({@code ChatPrincipal}). 그 토큰이 만료된 뒤 멤버십 캐시까지 비면 곧바로 이 경로다.
 *
 * <p>403 은 여기 오지 않는다. 그건 「토큰은 멀쩡한데 이 자원을 못 본다」라 갱신해도 달라지지 않는다.
 */
public class UpstreamRejectedCredentialException extends DomainException {

    public UpstreamRejectedCredentialException() {
        super(CommonErrorCode.UNAUTHORIZED);
    }
}
