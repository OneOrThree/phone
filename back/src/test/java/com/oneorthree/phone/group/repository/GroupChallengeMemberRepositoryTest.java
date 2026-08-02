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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

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

    private void upsert(LocalDate date, int usedMinutes) {
        groupChallengeMemberRepository.upsertWindowUsage(
                Generators.timeBasedEpochRandomGenerator().generate(),
                challenge.getId(), user.getId(), date, usedMinutes);
    }

    @Test
    @DisplayName("같은 (챌린지, 유저, 날짜) 재보고 → 행이 늘지 않고 마지막 값이 이긴다")
    void upsertKeepsSingleRowAndLastValueWins() {
        // given: 중간 보고 30분 → 최종 보고 95분
        upsert(DATE, 30);
        upsert(DATE, 95);

        // when
        List<GroupChallengeMember> rows = groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), DATE);

        // then
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getProgressMinutes()).isEqualTo(95);
        assertThat(rows.get(0).getUser().getId()).isEqualTo(user.getId());
    }

    @Test
    @DisplayName("다른 날짜 보고는 별도 행 — 날짜 차원(usage_date)이 유니크에 포함된다")
    void upsertSeparatesRowsByDate() {
        // given
        upsert(DATE, 40);
        upsert(DATE.plusDays(1), 70);

        // when & then: 날짜별 조회가 서로 다른 행을 돌려준다
        assertThat(groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), DATE))
                .singleElement()
                .extracting(GroupChallengeMember::getProgressMinutes)
                .isEqualTo(40);
        assertThat(groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), DATE.plusDays(1)))
                .singleElement()
                .extracting(GroupChallengeMember::getProgressMinutes)
                .isEqualTo(70);
    }
}
