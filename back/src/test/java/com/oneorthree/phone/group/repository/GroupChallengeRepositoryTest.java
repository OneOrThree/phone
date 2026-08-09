package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 챌린지 soft delete 전환의 실 SQL 검증 (Testcontainers PostgreSQL).
 *
 * <p>목록·중복 검사·단건 조회·시간대 겹침이 모두 {@code deleted_at IS NULL} 로 일관되게 삭제분을
 * 제외하는지 확인한다. 하나라도 빠지면 "삭제 후 같은 챌린지 재생성 불가" 버그가 된다.
 * 하드 딜리트가 실제로 CTI 상세 FK 를 위반한다는 것(전환 사유)도 여기서 실증한다.
 */
class GroupChallengeRepositoryTest extends RepositoryTestBase {

    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    EntityManager em;

    // 창 시각은 KST 벽시계 time (V32) — 날짜부라는 무의미한 자유도가 스키마에서 사라졌다.
    private static final LocalTime WINDOW_START = LocalTime.of(9, 0);
    private static final LocalTime WINDOW_END = LocalTime.of(18, 0);

    private Group saveGroup() {
        return groupRepository.save(Group.builder().name("스터디룸").maxMembers(10).build());
    }

    private GroupChallenge saveDurationChallenge(Group group, MissionCategory category, int minutes) {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).type(MissionType.DURATION).category(category)
                .status(GroupChallengeStatus.ACTIVE).build());
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(challenge).durationMinutes(minutes).build());
        return challenge;
    }

    private GroupChallenge saveWindowChallenge(Group group, LocalTime start, LocalTime end) {
        GroupChallenge challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).type(MissionType.TIME_WINDOW).category(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE).build());
        groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                .challenge(challenge).windowStart(start).windowEnd(end).build());
        return challenge;
    }

    @Test
    @DisplayName("하드 딜리트는 CTI 상세(durations) FK 를 위반한다 — soft delete 로 전환한 근거")
    void hardDeleteViolatesDetailForeignKey() {
        // given: duration 상세를 가진 챌린지. 영속성 컨텍스트를 비워야 DB 제약이 말을 한다
        // (안 비우면 Hibernate 가 DELETE 를 내기도 전에 TransientPropertyValueException 으로 막는다
        //  — ORM 단이든 DB 단이든 하드 딜리트는 어차피 실패한다는 뜻).
        Group group = saveGroup();
        GroupChallenge challenge = saveDurationChallenge(group, MissionCategory.FOCUS, 60);
        groupChallengeRepository.flush();
        em.clear();

        GroupChallenge reloaded = groupChallengeRepository.findById(challenge.getId()).orElseThrow();

        // when & then: 부모 행만 지우면 group_challenge_durations.challenge_id FK 가 막는다
        assertThatThrownBy(() -> {
            groupChallengeRepository.delete(reloaded);
            groupChallengeRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc — 삭제 마킹된 챌린지는 목록에서 빠진다")
    void listExcludesSoftDeleted() {
        // given: 살아있는 1건 + 삭제 마킹 1건
        Group group = saveGroup();
        GroupChallenge alive = saveDurationChallenge(group, MissionCategory.FOCUS, 60);
        GroupChallenge deleted = saveDurationChallenge(group, MissionCategory.SCREEN_TIME, 120);
        deleted.softDelete();
        groupChallengeRepository.flush();

        // when
        List<GroupChallenge> challenges =
                groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group);

        // then
        assertThat(challenges).extracting(GroupChallenge::getId).containsExactly(alive.getId());
    }

    @Test
    @DisplayName("existsBy...AndDeletedAtIsNull — 삭제 후에는 같은 카테고리로 다시 만들 수 있다(중복 아님)")
    void duplicateCheckExcludesSoftDeleted() {
        // given: FOCUS/DURATION 챌린지를 만들었다가 삭제
        Group group = saveGroup();
        GroupChallenge challenge = saveDurationChallenge(group, MissionCategory.FOCUS, 60);
        groupChallengeRepository.flush();
        assertThat(groupChallengeRepository.existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
                group, MissionCategory.FOCUS, MissionType.DURATION, GroupChallengeStatus.ACTIVE)).isTrue();

        // when
        challenge.softDelete();
        groupChallengeRepository.flush();

        // then: 재생성을 막던 exists 가 풀린다
        assertThat(groupChallengeRepository.existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
                group, MissionCategory.FOCUS, MissionType.DURATION, GroupChallengeStatus.ACTIVE)).isFalse();
    }

    @Test
    @DisplayName("findByIdAndGroupAndDeletedAtIsNull — 삭제된 챌린지 재삭제는 조회 단계에서 걸린다")
    void findByIdExcludesSoftDeleted() {
        // given
        Group group = saveGroup();
        GroupChallenge challenge = saveDurationChallenge(group, MissionCategory.FOCUS, 60);
        challenge.softDelete();
        groupChallengeRepository.flush();

        // when
        Optional<GroupChallenge> found =
                groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(challenge.getId(), group);

        // then
        assertThat(found).isEmpty();
    }

    @Test
    @DisplayName("findActiveByGroupForUpdate — 삭제 마킹된 챌린지의 창은 겹침 검사 대상에서 빠진다")
    void activeWindowLookupExcludesSoftDeleted() {
        // given: 09~18시 TIME_WINDOW 챌린지 (window 상세 행은 삭제 후에도 그대로 남는다)
        Group group = saveGroup();
        GroupChallenge challenge = saveWindowChallenge(group, WINDOW_START, WINDOW_END);
        groupChallengeWindowRepository.flush();
        assertThat(groupChallengeWindowRepository.findActiveByGroupForUpdate(group))
                .extracting(GroupChallengeWindow::getChallengeId)
                .containsExactly(challenge.getId());

        // when: 삭제 마킹
        challenge.softDelete();
        groupChallengeRepository.flush();

        // then: 대상에서 빠져 같은 시간대를 다시 만들 수 있다
        assertThat(groupChallengeWindowRepository.findActiveByGroupForUpdate(group)).isEmpty();
    }
}
