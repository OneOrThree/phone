package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.user.repository.domain.Provider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * 제공자 교환을 <b>실제로 수행</b>하는 요청 (계정 LLD §3-3).
 *
 * <p>이 표면을 조회와 나눈 것이 계약의 핵심이다. 하나로 합치면 「재생이었는가 교환이었는가」를 밖에서
 * 구분할 수 없고, 「IdP 를 두 번 부르지 않는다」를 <b>검증할 수단이 사라진다</b>. 나눠 두면 호출
 * 횟수 자체가 증거가 된다.
 *
 * @param credential 제공자가 준 원 자격(id_token · access_token · authorization_code). 저장하지
 *                   않으며 {@code AuthService} 의 기존 제공자 어댑터로 그대로 넘어간다
 * @param callerAccessToken 선택 AT 원문(게스트 승격·계정 전환용). 없으면 null —
 *                   기존 {@code AuthService.socialLogin} 이 {@code Authorization} 헤더 형태를
 *                   기대하므로 호출부가 {@code Bearer } 접두를 붙여 넘긴다
 * @param accountSwitchConfirmed 「이미 다른 회원 계정에 연결된 소셜 계정」 충돌을 사용자가 보고
 *                   <b>전환을 확정</b> 했는가 (GROMO-1994). 기본 {@code false} 이고, 그때는 기존대로
 *                   409 {@code SOCIAL_ACCOUNT_ALREADY_LINKED} 로 거절해 게스트 상태·데이터를 지킨다.
 *                   {@code true} 는 파기 동의를 담은 <b>다른 의도</b> 이므로 앱은 1단계와 다른
 *                   {@code X-Login-Attempt-Id} 로 보낸다(LLD §1 「수정한 사용자 의도에는 새 키를 쓴다」).
 *                   충돌이 실제로 없으면 이 값은 아무 일도 하지 않는다 — 평소 승격/신규 가입이다
 */
public record LoginAttemptExecuteRequest(
        @NotNull UUID attemptId,
        @NotBlank @Size(max = 64) String digestKeyId,
        @NotBlank @Size(max = 64) String credentialDigest,
        @NotNull Provider provider,
        @NotBlank @Size(max = 32) String credentialKind,
        @NotBlank String credential,
        @NotBlank @Size(max = 64) String termsVersion,
        String callerAccessToken,
        boolean accountSwitchConfirmed) {
}
