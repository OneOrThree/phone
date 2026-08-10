package com.oneorthree.phone.group.repository;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 창 사용분 보고 upsert 의 실 SQL 검증 (Testcontainers PostgreSQL).
 *
 * <p>{@code ON CONFLICT (group_challenge_id, user_id, usage_date)} 가 실제 유니크 제약과 맞물려
 * "(챌린지, 유저, 날짜)당 1행 + 마지막 값 승리"를 보장하는지 확인한다 — 이 제약이 동시 보고 레이스의
 * 방어선이므로 재실행이 행을 늘리면 안 된다.
 */
class GroupChallengeMemberRepositoryTest extends RepositoryTestBase {

    @Autowired
    GroupChallengeMemberRepository groupChallengeMemberRepository;
    @Autowired
    EntityManager entityManager;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    UserRepository userRepository;

    private static final LocalDate DATE = LocalDate.of(2026, 8, 1);

    private GroupChallenge challenge;
    private User user;

    @BeforeEach
    void setUp() {
        Group group = groupRepository.save(Group.builder().name("보고검증").maxMembers(10).build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).type(MissionType.TIME_WINDOW).category(MissionCategory.SCREEN_TIME)
                .status(GroupChallengeStatus.ACTIVE).build());
        user = userRepository.save(User.builder().nickname("재영").isGuest(false).build());
        // 네이티브 INSERT 가 FK 로 참조하므로 부모 행을 먼저 flush 해 둔다
        groupChallengeRepository.flush();
        userRepository.flush();
    }

    private int upsert(LocalDate date, int usedMinutes) {
        return upsert(date, usedMinutes, null);
    }

    private int upsert(LocalDate date, int usedMinutes, Instant measuredAt) {
        return groupChallengeMemberRepository.upsertWindowUsage(
                Generators.timeBasedEpochRandomGenerator().generate(),
                challenge.getId(), user.getId(), date, usedMinutes, measuredAt);
    }

    private GroupChallengeMember singleRow(LocalDate date) {
        // 네이티브 upsert 는 영속성 컨텍스트를 우회한다 — 캐시된 엔티티가 낡은 값을 돌려주지 않게
        // 매 조회 전 컨텍스트를 비우고 DB 에서 다시 읽는다.
        entityManager.clear();
        List<GroupChallengeMember> rows = groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), date);
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    @Test
    @DisplayName("같은 (챌린지, 유저, 날짜) 재보고 → 행이 늘지 않고 마지막 값이 이긴다(measured_at 없는 레거시)")
    void upsertKeepsSingleRowAndLastValueWins() {
        // given: 중간 보고 30분 → 최종 보고 95분 — measuredAt 없는 구앱 보고는 종전대로 마지막 값 승리
        upsert(DATE, 30);
        upsert(DATE, 95);

        // when
        GroupChallengeMember row = singleRow(DATE);

        // then
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getUser().getId()).isEqualTo(user.getId());
    }

    @Test
    @DisplayName("다른 날짜 보고는 별도 행 — 날짜 차원(usage_date)이 유니크에 포함된다")
    void upsertSeparatesRowsByDate() {
        // given
        upsert(DATE, 40);
        upsert(DATE.plusDays(1), 70);

        // when & then: 날짜별 조회가 서로 다른 행을 돌려준다
        assertThat(singleRow(DATE).getProgressMinutes()).isEqualTo(40);
        assertThat(singleRow(DATE.plusDays(1)).getProgressMinutes()).isEqualTo(70);
    }

    // ── measured_at 단조 갱신 (GROMO-1407 · N34) ─────────────────────────────

    private static final Instant T1 = Instant.parse("2026-08-01T12:00:00Z");
    private static final Instant T2 = Instant.parse("2026-08-01T12:30:00Z");

    @Test
    @DisplayName("역전 보고 무시 — 저장된 measured_at 보다 오래된 보고는 0행(값 불변)")
    void upsertIgnoresStaleReport() {
        // given: 최신 보고(T2)가 먼저 도착
        assertThat(upsert(DATE, 95, T2)).isEqualTo(1);

        // when: 지연 도착한 옛 보고(T1, 낮은 값) — 정산(finalize) 후 늦게 도착하는 중간 보고와
        // 같은 모양이다. 마지막 도착 승리라면 이 값이 최신값을 덮어 정산 근거가 어긋난다.
        int applied = upsert(DATE, 30, T1);

        // then: 조용히 무시 — 행 값과 measured_at 이 그대로다
        assertThat(applied).isZero();
        GroupChallengeMember row = singleRow(DATE);
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getMeasuredAt()).isEqualTo(T2);
    }

    @Test
    @DisplayName("같은 measured_at 재전송(재시도) → 갱신된다(멱등 — 재시도가 에러·유실이 되지 않는다)")
    void upsertIsIdempotentForSameMeasuredAt() {
        // given
        assertThat(upsert(DATE, 60, T1)).isEqualTo(1);

        // when: 같은 측정 시각의 재전송(네트워크 재시도)
        int applied = upsert(DATE, 60, T1);

        // then
        assertThat(applied).isEqualTo(1);
        assertThat(singleRow(DATE).getProgressMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("최신 measured_at 보고 → 갱신(단조 전진)")
    void upsertAppliesNewerReport() {
        // given
        upsert(DATE, 30, T1);

        // when
        int applied = upsert(DATE, 95, T2);

        // then
        assertThat(applied).isEqualTo(1);
        GroupChallengeMember row = singleRow(DATE);
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getMeasuredAt()).isEqualTo(T2);
    }

    @Test
    @DisplayName("저장값이 null(레거시 행)이면 어떤 보고든 갱신 — 시각이 생기며 단조 규칙이 시작된다")
    void upsertUpgradesLegacyRowWithoutMeasuredAt() {
        // given: measured_at 없는 레거시 행
        upsert(DATE, 30);
        assertThat(singleRow(DATE).getMeasuredAt()).isNull();

        // when
        int applied = upsert(DATE, 95, T1);

        // then
        assertThat(applied).isEqualTo(1);
        assertThat(singleRow(DATE).getMeasuredAt()).isEqualTo(T1);
    }

    @Test
    @DisplayName("저장값이 있는데 measured_at 없는 보고(구앱) → 무시 — 시각 없는 보고가 시각 있는 값을 못 덮는다")
    void upsertIgnoresUntimestampedReportOverTimestampedRow() {
        // given
        upsert(DATE, 95, T2);

        // when: 구앱(measuredAt 미전송)의 낮은 값 보고
        int applied = upsert(DATE, 10);

        // then: 역전 방어가 무의미해지지 않도록 버린다
        assertThat(applied).isZero();
        GroupChallengeMember row = singleRow(DATE);
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getMeasuredAt()).isEqualTo(T2);
    }
}
