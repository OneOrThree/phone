package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.user.repository.domain.Provider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * 제공자 교환 <b>전</b> 내구 시도 조회 (계정 LLD §3-1 · §3-2).
 *
 * <p>자격 원문이 아니라 Business 가 계산한 keyed digest 만 온다. 그래서 Data 는 원 code/credential 을
 * 알지 못하고, 이 표면 하나가 유출돼도 자격이 유출되지 않는다.
 *
 * <p>{@code attemptId} 만으로는 아무것도 돌려주지 않는다 — LLD §3 이 「{@code X-Login-Attempt-Id} 나
 * digest 만 받는 공개 복구 API 를 만들지 않는다」고 금지한다. digest 가 맞아야 결과가 나온다.
 *
 * <p>아래 다섯 필드는 전환 시도({@code switch_phase != null})의 재생 관문이 요구하는 증거다
 * (GROMO-1992). 모두 <b>nullable</b> 이다 — Data-first 혼합 배포와 일반 legacy 시도의 전송
 * 호환을 위해서이고, 전환 행에서는 하나라도 비면 {@code LOGIN_ATTEMPT_UNUSABLE} 로 fail-closed 한다.
 *
 * @param callerAccessToken 전환 source 게스트의 AT 원문 — 저장·로그 금지라 {@code toString} 이 가린다
 * @param accountSwitchConfirmed 저장된 전환 확정 의도와의 대조용. primitive 금지 — 생략과
 *                               {@code false} 를 구분해야 한다(생략은 UNUSABLE, false 는 CONFLICT)
 */
public record LoginAttemptLookupRequest(
        @NotNull UUID attemptId,
        @NotBlank @Size(max = 64) String digestKeyId,
        @NotBlank @Size(max = 64) String credentialDigest,
        String callerAccessToken,
        Provider provider,
        @Size(max = 32) String credentialKind,
        @Size(max = 64) String termsVersion,
        Boolean accountSwitchConfirmed) {

    /** AT 원문이 실리므로 로그·덤프에서 가린다. */
    @Override
    public String toString() {
        return "LoginAttemptLookupRequest[attemptId=" + attemptId + ", provider=" + provider
                + ", credentialKind=" + credentialKind + ", callerAccessToken=redacted]";
    }
}
