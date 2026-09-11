package com.oneorthree.business.common.http;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 예산 계약 — 5초/15초가 <b>재시도까지 합친 전체</b>라는 것을 코드로 못 박는다.
 *
 * <p>예산을 넘긴 재시도는 앱이 이미 끊은 뒤에 성공하고, 사용자에게는 되돌릴 수 없는
 * {@code matched:false} 만 남는다.
 */
@DisplayName("요청 시간 예산")
class DeadlineTest {

    @Test
    @DisplayName("예산이 read timeout 을 못 담으면 시도하지 않는다")
    void 여유없으면거절() {
        Deadline deadline = Deadline.startingNow(Duration.ofMillis(100));
        assertThat(deadline.hasRoomFor(Duration.ofMillis(1500))).isFalse();
    }

    @Test
    @DisplayName("여유가 있으면 통과한다")
    void 여유있으면허용() {
        Deadline deadline = Deadline.startingNow(Duration.ofSeconds(5));
        assertThat(deadline.hasRoomFor(Duration.ofMillis(1500))).isTrue();
    }

    @Test
    @DisplayName("예산 없는 호출은 상류 read timeout 만이 상한이다")
    void unbounded() {
        Deadline deadline = Deadline.unbounded();
        assertThat(deadline.isUnbounded()).isTrue();
        assertThat(deadline.hasRoomFor(Duration.ofDays(1))).isTrue();
    }

    @Test
    @DisplayName("소진된 예산의 남은 시간은 0 이고 음수가 되지 않는다")
    void 소진되면0() throws Exception {
        Deadline deadline = Deadline.startingNow(Duration.ofMillis(1));
        Thread.sleep(5);
        assertThat(deadline.remaining()).isEqualTo(Duration.ZERO);
    }
}
