package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

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

    @Autowired
    UserRepository userRepository;

    private static Instant startOfDayKst(LocalDate date) {
        return date.atStartOfDay(KST).toInstant();
    }

    private User save(boolean guest, Instant lastActiveAt, Instant deletedAt) {
        return userRepository.saveAndFlush(User.builder()
                .isGuest(guest)
                .lastActiveAt(lastActiveAt)
                .deletedAt(deletedAt)
                .build());
    }

    @Test
    @DisplayName("findInactiveReturnTargets — D+3 경계 유저만 반환하고 D+2·게스트·소프트딜리트는 제외")
    void findInactiveReturnTargetsFiltersBoundaryGuestAndDeleted() {
        Instant d3 = startOfDayKst(TODAY.minusDays(3)).plusSeconds(43_200); // D-3 KST 정오
        Instant d2 = startOfDayKst(TODAY.minusDays(2)).plusSeconds(43_200); // D-2 KST 정오(비대상)

        User target = save(false, d3, null);
        save(false, d2, null);       // 2일차 — 경계 밖
        save(true, d3, null);        // 게스트 — 제외
        save(false, d3, NOW);        // 소프트딜리트 — 제외

        List<User> found = userRepository.findInactiveReturnTargets(
                startOfDayKst(TODAY.minusDays(3)), startOfDayKst(TODAY.minusDays(2)));

        assertThat(found).extracting(User::getId).containsExactly(target.getId());
    }

    @Test
    @DisplayName("touchLastActiveAt — 오늘 이전 값이면 1행 갱신, 이미 오늘이면 0행(스로틀)")
    void touchLastActiveAtThrottlesToOncePerDay() {
        Instant startOfTodayKst = startOfDayKst(TODAY);
        User stale = save(false, startOfDayKst(TODAY.minusDays(1)).plusSeconds(3600), null); // 어제
        User fresh = save(false, startOfTodayKst.plusSeconds(3600), null);                    // 오늘 새벽

        int updatedStale = userRepository.touchLastActiveAt(stale.getId(), NOW, startOfTodayKst);
        int updatedFresh = userRepository.touchLastActiveAt(fresh.getId(), NOW, startOfTodayKst);

        assertThat(updatedStale).isEqualTo(1); // 어제 값 → 갱신됨
        assertThat(updatedFresh).isZero();      // 오늘 값 → 무쓰기(하루 1회 스로틀)
    }
}
