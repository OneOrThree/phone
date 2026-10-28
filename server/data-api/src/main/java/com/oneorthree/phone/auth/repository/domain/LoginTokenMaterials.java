package com.oneorthree.phone.auth.repository.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 원 토큰을 <b>다시 만들기 위한</b> 고정 서명 재료 (계정 LLD §3 「고정 서명 재료」).
 *
 * <p>토큰 문자열 대신 이것을 보관한다. HS256 서명은 결정적이므로 같은 claims 를 같은 순서로 다시
 * 조립하면 원본과 바이트가 같은 토큰이 나온다 — 그래서 저장소에는 자격이 남지 않으면서도 재생이
 * 가능하다.
 *
 * <p>{@code refreshJti} 가 재료에 들어가는 이유: {@code JwtProvider} 는 RT 에만 무작위 {@code jti}
 * 를 박는다(같은 초에 발급된 두 RT 를 가르기 위해). 이 값을 고정하지 않으면 재생 토큰이 원본과 달라
 * 저장된 RT 해시와 어긋나고, 앱이 받은 RT 로 refresh 가 되지 않는다.
 *
 * <p>{@code authGeneration}·{@code sessionId} 는 <b>없을 수 있고, 없으면 없는 채로 둔다</b>. 구
 * 발급 경로는 이 두 claim 을 싣지 않으며, 재생할 때 현재 값으로 채우면 원본과 다른 토큰이 된다.
 */
public record LoginTokenMaterials(
        boolean guest,
        Long authGeneration,
        Instant accessIssuedAt,
        Instant accessExpiresAt,
        Instant refreshIssuedAt,
        Instant refreshExpiresAt,
        UUID refreshJti) {
}
