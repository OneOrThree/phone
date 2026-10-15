package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamDomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 「이 판정으로 대기 의도를 닫아도 되는가」의 정책 표.
 *
 * <p>HTTP 를 태우지 않는다 — 상류 스텁으로 덮으면 <b>전송 계층의 특성</b>이 섞인다. 실제로
 * {@code SimpleClientHttpRequestFactory}(JDK {@code HttpURLConnection})는 401 의 오류 본문을 흘려
 * 버려서, 코드를 실어 보낸 401 조차 {@code UpstreamDomainException} 이 아니라 자격 거절로 분류된다.
 * 그건 전송 계층 사실이고 여기서 볼 것은 <b>정책</b>이라, 예외를 직접 만들어 표를 고정한다.
 */
@DisplayName("claim 의도 종결 판정")
class ClaimIntentTerminationTest {

    private static UpstreamDomainException rejection(int status, String code) {
        return new UpstreamDomainException(status, code, "m", null);
    }

    @ParameterizedTest(name = "{1}({0}) 은 종결 대상이다")
    @CsvSource({
            // link/src/lib/links.ts:147 — links 행 자체가 없다. 링크는 재생성되지 않는다.
            "404, SLUG_NOT_FOUND",
            // link/src/lib/ledger.ts:24 — 탈퇴는 익명화를 동반해 되돌릴 수 없다.
            "410, USER_WITHDRAWN",
    })
    void 다시물어도같은답이면종결(int status, String code) {
        assertThat(ClaimIntentTermination.isTerminal(rejection(status, code))).isTrue();
    }

    @ParameterizedTest(name = "{1}({0}) 은 종결 대상이 아니다")
    @CsvSource({
            // 배선·배포 사고다. 고치고 다시 부르면 답이 달라진다 — 사용자 판정으로 접으면 잘못된 배포
            // 한 번에 대기 의도가 통째로 지워진다(link/src/lib/auth.ts:51,60 · route.ts:27,40).
            "401, INVALID_SERVICE_TOKEN",
            "403, SERVICE_ROUTE_FORBIDDEN",
            "401, USER_REQUIRED",
            "404, ROUTE_NOT_FOUND",
            // 「만료된 자격」과 「셀프 초대」를 한 코드로 접은 값이다(InviteLinkErrorCode:21-26). 앞은
            // 재개가 링크에서 새 자격을 받아 다시 시도하면 성공할 수 있다.
            "409, CLAIM_CAPABILITY_INVALID",
            // 판정 주체가 Data 의 멤버십 상태라 링크 쪽 사실만으로 영구성을 단정할 수 없다.
            "409, CLAIM_REVOKED",
            // 저장된 요청 해시와 본문이 어긋났다 = 우리 버그다. 종결로 접으면 「정상 종료」로 묻힌다.
            "409, IDEMPOTENCY_KEY_CONFLICT",
    })
    void 답이달라질수있으면비종결(int status, String code) {
        assertThat(ClaimIntentTermination.isTerminal(rejection(status, code))).isFalse();
    }

    @Test
    @DisplayName("408·429 는 코드가 허용목록에 있어도 종결이 아니다 — 「지금 말고 나중에」다")
    void 시간관련거절은비종결() {
        assertThat(ClaimIntentTermination.isTerminal(rejection(408, "SLUG_NOT_FOUND"))).isFalse();
        assertThat(ClaimIntentTermination.isTerminal(rejection(429, "SLUG_NOT_FOUND"))).isFalse();
    }

    @Test
    @DisplayName("retryAfterMs 가 실려 있으면 코드와 무관하게 비종결 — 그 값 자체가 「다시 오라」다")
    void 재시도지연이실리면비종결() {
        UpstreamDomainException retryable =
                new UpstreamDomainException(404, "SLUG_NOT_FOUND", "m", 4200L);
        assertThat(ClaimIntentTermination.isTerminal(retryable)).isFalse();
    }

    @Test
    @DisplayName("코드가 없으면 비종결 — Set.of 의 contains(null) 은 NPE 라 가드가 필요하다")
    void 코드없으면비종결() {
        assertThat(ClaimIntentTermination.isTerminal(rejection(404, null))).isFalse();
    }
}
