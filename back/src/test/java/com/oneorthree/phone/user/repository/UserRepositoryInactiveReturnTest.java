package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 미접속 복귀 푸시 (GROMO-578) 리포지토리 쿼리 검증 — 실 DB(Testcontainers) 경계 정합.
 * findInactiveReturnTargets 의 KST 하루 경계·isGuest·소프트딜리트 필터와 touchLastActiveAt 의 스로틀 가드.
 */
class UserRepositoryInactiveReturnTest extends RepositoryTestBase {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 6);
    // 배치 고정 시각 2026-07-06 10:00 KST
    private static final Instant NOW = Instant.parse("2026-07-06T01:00:00Z");
    // 활동 갱신 스로틀 창 (GROMO-903) — application-dev/prod.yml 의 app.user-activity.touch-interval 과 같은 값
    private static final Duration TOUCH_INTERVAL = Duration.ofHours(2);

    @Autowired
    UserRepository userRepository;

    private static Instant startOfDayKst(LocalDate date) {
        return date.atStartOfDay(KST).toInstant();
    }

    private User save(boolean guest, Instant lastActiveAt, boolean deleted) {
        return userRepository.saveAndFlush(User.builder()
                .isGuest(guest)
                .lastActiveAt(lastActiveAt)
                .isDeleted(deleted)
                .build());
    }

    @Test
    @DisplayName("findInactiveReturnTargets — D+3 경계 유저만 반환하고 D+2·게스트·소프트딜리트는 제외")
    void findInactiveReturnTargetsFiltersBoundaryGuestAndDeleted() {
        Instant d3 = startOfDayKst(TODAY.minusDays(3)).plusSeconds(43_200); // D-3 KST 정오
        Instant d2 = startOfDayKst(TODAY.minusDays(2)).plusSeconds(43_200); // D-2 KST 정오(비대상)

        User target = save(false, d3, false);
        save(false, d2, false);      // 2일차 — 경계 밖
        save(true, d3, false);       // 게스트 — 제외
        save(false, d3, true);       // 소프트딜리트 — 제외

        List<User> found = userRepository.findInactiveReturnTargets(
                startOfDayKst(TODAY.minusDays(3)), startOfDayKst(TODAY.minusDays(2)));

        assertThat(found).extracting(User::getId).containsExactly(target.getId());
    }

    @Test
    @DisplayName("touchLastActiveAt — 스로틀 창 밖이면 1행 갱신, 창 안이면 0행(무쓰기)")
    void touchLastActiveAtThrottlesWithinWindow() {
        // 슬라이딩 창 기준 (GROMO-903) — 달력 하루가 아니라 "마지막 갱신 후 경과 시간"으로 자른다
        Instant staleBefore = NOW.minus(TOUCH_INTERVAL);
        User stale = save(false, NOW.minus(TOUCH_INTERVAL).minusSeconds(3600), false); // 창 밖
        User fresh = save(false, NOW.minus(TOUCH_INTERVAL).plusSeconds(3600), false);  // 창 안

        int updatedStale = userRepository.touchLastActiveAt(stale.getId(), NOW, staleBefore);
        int updatedFresh = userRepository.touchLastActiveAt(fresh.getId(), NOW, staleBefore);

        assertThat(updatedStale).isEqualTo(1); // 창 밖 → 갱신됨
        assertThat(updatedFresh).isZero();      // 창 안 → 무쓰기(호출측 needsTouch 를 통과해도 막는 최종 방어선)
    }

    @Test
    @DisplayName("findLastActiveAtIfActive — 활성 유저는 저장값 반환, 소프트딜리트·미존재 유저는 empty (GROMO-903)")
    void findLastActiveAtIfActiveReturnsValueOnlyForActiveUser() {
        Instant lastActiveAt = startOfDayKst(TODAY.minusDays(1)).plusSeconds(3600);
        User active = save(false, lastActiveAt, false);
        User deleted = save(false, lastActiveAt, true);

        // 인증 hot path 가 이 한 번의 조회로 "탈퇴 여부"와 "오늘 갱신 필요 여부"를 동시에 얻는다
        assertThat(userRepository.findLastActiveAtIfActive(active.getId())).contains(lastActiveAt);
        // empty 두 경우 모두 기존 existsByIdAndIsDeletedFalse=false 와 같은 집합 → 동일하게 401
        assertThat(userRepository.findLastActiveAtIfActive(deleted.getId())).isEmpty();
        assertThat(userRepository.findLastActiveAtIfActive(UUID.randomUUID())).isEmpty();
    }
}
