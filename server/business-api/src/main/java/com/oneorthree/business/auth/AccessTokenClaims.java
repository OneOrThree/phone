package com.oneorthree.business.auth;

import java.util.UUID;

/**
 * 검증을 통과한 access token 에서 꺼낸 값들.
 *
 * @param userId  AT subject — <b>이것만이</b> 요청자 신원이다. 외부 {@code X-User-Id} 는 폐기된다(A22 ㉸)
 * @param guest   발급 시점 게스트 여부({@code guest} 클레임)
 * @param authGeneration 유저 축 세대({@code gen} 클레임). <b>구 AT 에는 이 클레임이 없어 null 이다</b>
 *                (현 {@code JwtProvider.buildToken} 은 {@code type}·{@code guest} 만 싣는다).
 *                <b>null 을 Data 의 현재 세대로 채우면 안 된다</b> — 로그아웃 전에 발급된 옛 AT 가
 *                최신 세대로 태깅돼 tombstone 을 우회한다(A22 ㊍). 없으면 없는 채로 흘려보내고,
 *                수신 측이 「세대 검사 없이 수락」할지 「거부」할지를 롤아웃 단계로 정한다
 * @param sessionId 이 AT 가 속한 로그인 세션({@code sid} 클레임). <b>구 AT 에는 없어 null 이다</b>.
 *                <b>서버가 서명한 값</b>이라 앱이 무엇을 저장하든 위조할 수 없고, 그래서 자격
 *                ({@code deviceBootstrap})을 저장하지 않는 앱의 세션 확인 근거가 된다(A22 ㋤ 구 앱 경로).
 *                자격 <b>대신</b>은 아니다 — 「이 세션이 지금 살아 있는가」만 답할 뿐, 1회용 자격이 여는
 *                소유권 이전은 열지 않는다. null 을 현재 세션으로 채우면 안 되는 이유는 {@code gen} 과 같다
 */
public record AccessTokenClaims(UUID userId, boolean guest, Long authGeneration, UUID sessionId) {
}
