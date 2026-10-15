package com.oneorthree.phone.group.support;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.service.GroupBetJudge;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 회차 시각 조립(KST 자정 경계) 고정 테스트 (GROMO-2129) — 돈이 걸린 회차의 시작·마감·정산 대기
 * 시각이 실제로 {@code Asia/Seoul} 자정에서 갈리는지 리터럴 Instant 로 본다.
 *
 * <p>{@link GroupBetSessionFactory#create}·{@link GroupBetSessionFactory#joinClosesAtOn} 은
 * 둘 다 {@code sessionDate}(LocalDate)를 직접 받는 순수 함수라 Clock 없이도 값을 고정할 수 있다 —
 * {@code Instant.now()}·DB {@code now()} 어느 쪽도 타지 않는다.
 */
class GroupBetSessionFactoryTest {

    private final GroupBetSessionFactory factory = new GroupBetSessionFactory();

    private static final UUID CHALLENGE_ID = UUID.randomUUID();

    private GroupChallengeBet bet() {
        return GroupChallengeBet.builder().stake(30).build();
    }

    private Group group() {
        return Group.builder().build();
    }

    private GroupChallenge challenge() {
        return GroupChallenge.builder()
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build();
    }

    /** 하루형(DURATION) FOCUS 대상 — 창 시각 없이 회차일 00:00~익일 00:00(KST) 경계만 본다. */
    private GroupBetJudge.Target durationTarget() {
        return new GroupBetJudge.Target(
                CHALLENGE_ID, MissionCategory.FOCUS, MissionType.DURATION, 60, null, null);
    }

    @Test
    @DisplayName("하루형 회차의 시작·마감은 KST 자정(=UTC 15:00:00 전날)에 정확히 걸린다"
            + " — UTC 로 존이 바뀌면 9시간 어긋난다")
    void createPinsDailySessionBoundariesToKstMidnight() {
        LocalDate sessionDate = LocalDate.of(2026, 8, 1);

        GroupChallengeBetSession session =
                factory.create(bet(), group(), challenge(), durationTarget(), sessionDate);

        // 시작 = 회차일(2026-08-01) 00:00 KST = 전날 15:00 UTC.
        assertThat(session.getStartsAt()).isEqualTo(Instant.parse("2026-07-31T15:00:00Z"));
        // 마감 = 익일(2026-08-02) 00:00 KST — 회차일 안에서만 산다는 §A6-1 의 경계 그 자체.
        assertThat(session.getClosesAt()).isEqualTo(Instant.parse("2026-08-01T15:00:00Z"));
        // 1초 전(2026-08-01 23:59:59 KST)엔 아직 마감되지 않았다 — 자정 그 순간이 경계다.
        assertThat(session.getClosesAt()).isAfter(Instant.parse("2026-08-01T14:59:59Z"));
        // 하루형 참가 마감 = 마감과 같다(LLD §1.1).
        assertThat(session.getJoinClosesAt()).isEqualTo(session.getClosesAt());
        // FOCUS 하루형 정산 그레이스 1시간 — 마감 + 1h(GROMO-1411 후속, DURATION_FOCUS_SETTLE_GRACE_HOURS).
        assertThat(session.getSettleAfter()).isEqualTo(Instant.parse("2026-08-01T16:00:00Z"));
    }

    @Test
    @DisplayName("joinClosesAtOn 은 create 의 closesAt 과 같은 경계를 낸다 — 두 진입점이 갈리지 않는다")
    void joinClosesAtOnMatchesCreateBoundary() {
        Instant joinClosesAt = factory.joinClosesAtOn(durationTarget(), LocalDate.of(2026, 8, 1));

        assertThat(joinClosesAt).isEqualTo(Instant.parse("2026-08-01T15:00:00Z"));
    }

    @Test
    @DisplayName("연속한 두 회차일의 마감·시작이 같은 순간에서 맞물린다 — 경계를 공유하고 빈틈·겹침이 없다")
    void consecutiveSessionsMeetAtSameBoundaryInstant() {
        GroupChallengeBetSession day1 =
                factory.create(bet(), group(), challenge(), durationTarget(), LocalDate.of(2026, 8, 1));
        GroupChallengeBetSession day2 =
                factory.create(bet(), group(), challenge(), durationTarget(), LocalDate.of(2026, 8, 2));

        assertThat(day1.getClosesAt()).isEqualTo(day2.getStartsAt());
        assertThat(day1.getClosesAt()).isEqualTo(Instant.parse("2026-08-01T15:00:00Z"));
    }
}
