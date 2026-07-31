package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 활동 갱신 필요 여부 판정(needsTouch)의 KST 하루 경계 검증 (GROMO-903).
 * DB 왕복도 트랜잭션도 없는 순수 계산이라 Mockito 유닛으로 충분하다.
 */
class UserActivityServiceTest {

    // 2026-07-06 10:00 KST — 오늘(KST) 시작은 2026-07-05T15:00:00Z 다.
    private static final Instant NOW = Instant.parse("2026-07-06T01:00:00Z");

    private final UserActivityService userActivityService =
            new UserActivityService(Mockito.mock(UserRepository.class));

    @Test
    @DisplayName("오늘(KST) 시작 이전 값이면 갱신이 필요하다")
    void staleLastActiveNeedsTouch() {
        Instant yesterday = Instant.parse("2026-07-05T01:00:00Z"); // 2026-07-05 10:00 KST

        assertThat(userActivityService.needsTouch(yesterday, NOW)).isTrue();
    }

    @Test
    @DisplayName("오늘(KST) 안의 값이면 갱신이 필요 없다 — UTC 로는 어제여도 KST 기준으로 판정한다")
    void lastActiveWithinTodayKstSkipsTouch() {
        // UTC 로는 07-05 지만 KST 로는 07-06 01:00 — 타임존을 UTC 로 잡으면 여기서 오판한다
        Instant earlyTodayKst = Instant.parse("2026-07-05T16:00:00Z");

        assertThat(userActivityService.needsTouch(earlyTodayKst, NOW)).isFalse();
    }

    @Test
    @DisplayName("정확히 오늘(KST) 시작 시각이면 오늘로 보고 갱신하지 않는다 (경계 포함)")
    void exactStartOfTodayKstSkipsTouch() {
        Instant startOfTodayKst = Instant.parse("2026-07-05T15:00:00Z");

        assertThat(userActivityService.needsTouch(startOfTodayKst, NOW)).isFalse();
    }

    @Test
    @DisplayName("last_active_at 가 null 이면 fail-safe 로 갱신한다")
    void nullLastActiveNeedsTouch() {
        assertThat(userActivityService.needsTouch(null, NOW)).isTrue();
    }
}
