package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 활동 갱신 필요 여부 판정(needsTouch)의 슬라이딩 창 검증 (GROMO-903).
 * DB 왕복도 트랜잭션도 없는 순수 계산이라 Mockito 유닛으로 충분하다.
 */
class UserActivityServiceTest {

    private static final Duration TOUCH_INTERVAL = Duration.ofHours(2);
    private static final Instant NOW = Instant.parse("2026-07-06T01:00:00Z");

    private final UserActivityService userActivityService =
            new UserActivityService(Mockito.mock(UserRepository.class), TOUCH_INTERVAL);

    @Test
    @DisplayName("마지막 갱신이 창 밖이면 갱신이 필요하다")
    void lastActiveOutsideWindowNeedsTouch() {
        Instant outsideWindow = NOW.minus(TOUCH_INTERVAL).minusSeconds(60);

        assertThat(userActivityService.needsTouch(outsideWindow, NOW)).isTrue();
    }

    @Test
    @DisplayName("마지막 갱신이 창 안이면 갱신하지 않는다")
    void lastActiveWithinWindowSkipsTouch() {
        Instant insideWindow = NOW.minus(TOUCH_INTERVAL).plusSeconds(60);

        assertThat(userActivityService.needsTouch(insideWindow, NOW)).isFalse();
    }

    @Test
    @DisplayName("정확히 창 경계면 아직 유효한 것으로 보고 갱신하지 않는다")
    void exactWindowBoundarySkipsTouch() {
        assertThat(userActivityService.needsTouch(NOW.minus(TOUCH_INTERVAL), NOW)).isFalse();
    }

    @Test
    @DisplayName("날짜(UTC·KST 어느 쪽이든)가 바뀌어도 창 안이면 갱신하지 않는다 — 스로틀은 달력과 무관하다")
    void dateRolloverInsideWindowStillSkipsTouch() {
        // 자정을 막 넘긴 시각에 그날 첫 활동을 한 경우 — 값이 전날로 남는 알려진 트레이드오프.
        // 그 대가로 스로틀에서 타임존이 사라졌다(글로벌 서비스에서 특정 국가 자정을 전 유저에게 쓸 수 없다).
        Instant justAfterMidnight = Instant.parse("2026-07-06T00:30:00Z");
        Instant beforeMidnight = Instant.parse("2026-07-05T23:00:00Z");

        assertThat(userActivityService.needsTouch(beforeMidnight, justAfterMidnight)).isFalse();
    }

    @Test
    @DisplayName("last_active_at 가 null 이면 fail-safe 로 갱신한다")
    void nullLastActiveNeedsTouch() {
        assertThat(userActivityService.needsTouch(null, NOW)).isTrue();
    }
}
