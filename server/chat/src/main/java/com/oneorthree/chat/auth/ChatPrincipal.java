package com.oneorthree.chat.auth;

import java.security.Principal;
import java.util.UUID;

/**
 * STOMP 세션에 묶이는 인증 주체 — CONNECT 때 한 번 만들어 세션이 끝날 때까지 따라다닌다.
 *
 * <p>{@code bearer} 를 들고 다니는 것이 이 record 의 유일한 특이점이다. 멤버십 조회가 아직 요청자의
 * AT 로 상류를 부르기 때문인데({@code GroupClient} 참조), 그러려면 CONNECT 때 받은 헤더를 세션에
 * 보관하는 수밖에 없다 — STOMP 의 SEND·SUBSCRIBE 프레임은 인증 헤더를 다시 싣지 않는다.
 *
 * <p>SUBSCRIBE·SEND 때는 저장한 토큰을 다시 검증한다. 다른 기기가 멤버십 캐시를 채워도
 * 만료된 토큰의 발신·구독이 허용되지 않으며, {@code UNAUTHORIZED} 를 받은 앱은 토큰을 갱신하고
 * 다시 연결해야 한다. 토큰 만료 시 기존 구독을 강제로 해제하지는 않는다.
 *
 * @param userId 인증된 요청자
 * @param bearer {@code Authorization} 헤더 원문({@code "Bearer …"} 포함). 로그에 찍지 말 것
 */
public record ChatPrincipal(UUID userId, String bearer) implements Principal {

    @Override
    public String getName() {
        return userId.toString();
    }
}
