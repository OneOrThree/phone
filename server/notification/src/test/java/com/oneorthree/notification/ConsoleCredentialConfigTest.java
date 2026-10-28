package com.oneorthree.notification;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 콘솔 자격 설정은 <b>기동에서</b> 걸러진다.
 *
 * <p>감사 원장의 행위자는 「어느 토큰으로 인증했는가」에서 나온다. 그래서 자격 설정이 잘못된 채 서비스가
 * 뜨면 원장이 조용히 쓸모없어지거나 관리 API 가 통째로 잠긴다 — 둘 다 «떠 있는데 틀린» 상태라
 * 배포 뒤에야 드러난다. 여기서 죽는 편이 낫다.
 */
@DisplayName("콘솔 자격 설정 검증")
class ConsoleCredentialConfigTest {

    private static void auth(String console) {
        new ServiceAuth("biz-token", "data-token", console);
    }

    @Test
    @DisplayName("정상 형태는 통과한다 — 행위자별 토큰 목록")
    void perActorTokensAreAccepted() {
        assertThatCode(() -> auth("member-1:a,member-2:b,member-3:c")).doesNotThrowAnyException();
    }

    /**
     * 길이로 「콜론이 끝이 아니다」만 보면 <b>공백뿐인 토큰</b>이 통과한다. {@code trim} 이 떼지 못하는
     * 공백(U+2028 등)이 남으면 정상 토큰처럼 등재되고, 서비스는 뜨지만 유효한 콘솔 자격이 없어 관리
     * API 가 잠긴다.
     */
    @Test
    @DisplayName("공백뿐인 토큰은 기동에서 거부한다 — 떠 있는데 잠긴 상태가 더 나쁘다")
    void aBlankTokenIsRejectedAtStartup() {
        assertThatThrownBy(() -> auth("member-1: "))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> auth("member-1: "))
                .as("trim 이 떼지 못하는 공백도 토큰이 아니다")
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("콘솔 토큰이 비어 있습니다");
        assertThatThrownBy(() -> auth("member-1: ,member-2:b"))
                .as("다른 항목이 멀쩡해도 통과시키지 않는다 — 그 한 자리가 잠긴 계정이다")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("토큰 하나를 공유하는 옛 형태와 계약 밖 행위자 이름은 거부한다")
    void sharedOrUnknownActorsAreRejected() {
        assertThatThrownBy(() -> auth("one-shared-token"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("member-N:토큰");
        assertThatThrownBy(() -> auth("member-9:a")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> auth("member-1:a,member-2:a"))
                .as("같은 토큰을 둘이 쓰면 행위자를 가릴 수 없다")
                .isInstanceOf(IllegalStateException.class);
    }
}
