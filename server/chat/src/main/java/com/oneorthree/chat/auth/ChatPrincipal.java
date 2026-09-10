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
 * <p><b>대가</b>: 토큰이 만료돼도 세션은 계속 산다. 소켓을 끊었다 붙기 전까지는 만료된 AT 로
 * 상류를 부르게 되고, 그때 상류는 401 을 준다. 그 401 은 <b>{@code UNAUTHORIZED} 그대로</b>
 * 올라간다({@code UpstreamRejectedCredentialException}) — 「토큰을 갱신하고 다시 붙어라」이지
 * 「이 섬의 멤버가 아니다」가 아니기 때문이다. 앱은 그 코드를 보고 AT 를 갱신하면서 소켓도 다시
 * 연결해야 한다. A9 의 서비스 토큰 표면으로 옮기면 이 문제는 사라진다(그때는 세션이 토큰을 들고
 * 다닐 이유가 없다).
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
