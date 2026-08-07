package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.GroupBetHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 내기 히스토리 조회(GROMO-1207) 통합 테스트 — keyset 페이지네이션(hasNext/nextCursor)·status
 * 필터(CANCELED 제외)·권한(게스트/비그룹원 거절)·정산 근거 필드 매핑을 실 DB 로 고정한다.
 *
 * <p>정산 경로가 근거를 <b>쓰는</b> 것은 {@link GroupBetSettlementIntegrationTest} ·
 * {@link GroupBetCategorySettlementIntegrationTest} 가 고정한다 — 여기는 저장된 근거가 조회로
 * <b>나오는</b> 쪽만 본다. 픽스처·정리 방식은 {@link GroupBetLeaveIntegrationTest} 와 같다.
 */
class GroupBetHistoryIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetService groupBetService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    UserRepository userRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int GOAL_MINUTES = 120;
    private static final int STAKE = 30;
    private static final LocalDate BASE_DATE = LocalDate.of(2026, 7, 31);

    private Group group;
    private GroupChallenge challenge;
    private User member;

    private final List<User> users = new ArrayList<>();
    private final List<GroupMember> members = new ArrayList<>();
    private final List<GroupChallenge> challenges = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = durationChallenge();
        member = memberUser("그룹원");
    }

    @AfterEach
    void tearDown() {
        // FK 역순 — 다른 테스트 클래스는 @Transactional 롤백이라 여기 남은 행이 곧 오염이다.
        bets.forEach(b -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(b.getId()))));
        groupChallengeBetRepository.deleteAll(bets);
        challenges.forEach(c -> groupChallengeDurationRepository.findById(c.getId())
                .ifPresent(groupChallengeDurationRepository::delete));
        groupChallengeRepository.deleteAll(challenges);
        groupMemberRepository.deleteAll(members);
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        members.clear();
        challenges.clear();
        bets.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private GroupChallenge durationChallenge() {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        challenges.add(saved);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).durationMinutes(GOAL_MINUTES).build());
        return saved;
    }

    private User plainUser(String nickname, boolean guest) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(guest).build());
        users.add(user);
        return user;
    }

    private User memberUser(String nickname) {
        User user = plainUser(nickname, false);
        members.add(groupMemberRepository.save(GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build()));
        return user;
    }

    /** 정산이 끝난 내기 — 근거 스냅샷(goalMinutes)은 V29 규약대로 채워 넣는다. */
    private GroupChallengeBet settledBet(GroupBetStatus status, LocalDate betDate) {
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).creatorUser(member)
                .stake(STAKE).betDate(betDate).status(status)
                .settledAt(betDate.plusDays(1).atStartOfDay(KST).toInstant())
                .goalMinutes(GOAL_MINUTES)
                .build());
        bets.add(bet);
        return bet;
    }

    private GroupChallengeBetParticipant participant(
            GroupChallengeBet bet, User user, Boolean achieved, Integer payout, Integer progressMinutes) {
        return groupChallengeBetParticipantRepository.save(GroupChallengeBetParticipant.builder()
                .bet(bet).user(user).achieved(achieved).payout(payout)
                .progressMinutes(progressMinutes).build());
    }

    private GroupBetHistorySliceResponse history(UUID userId, UUID cursor, int size) {
        return groupBetService.getBetHistory(group.getId(), challenge.getId(), userId, cursor, size);
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("bet_date 내림차순 keyset 페이지네이션 — nextCursor 로 끊김 없이 이어지고 마지막 페이지는 hasNext=false")
    void paginatesByBetDateDescWithKeysetCursor() {
        for (int i = 0; i < 5; i++) {
            settledBet(GroupBetStatus.SETTLED, BASE_DATE.minusDays(i));
        }

        GroupBetHistorySliceResponse first = history(member.getId(), null, 2);
        assertThat(first.content()).extracting(GroupBetHistoryItemResponse::getBetDate)
                .containsExactly(BASE_DATE, BASE_DATE.minusDays(1));
        assertThat(first.hasNext()).isTrue();
        assertThat(first.nextCursor()).isEqualTo(first.content().get(1).getBetId());
        assertThat(first.size()).isEqualTo(2);

        GroupBetHistorySliceResponse second = history(member.getId(), first.nextCursor(), 2);
        assertThat(second.content()).extracting(GroupBetHistoryItemResponse::getBetDate)
                .containsExactly(BASE_DATE.minusDays(2), BASE_DATE.minusDays(3));
        assertThat(second.hasNext()).isTrue();

        GroupBetHistorySliceResponse last = history(member.getId(), second.nextCursor(), 2);
        assertThat(last.content()).extracting(GroupBetHistoryItemResponse::getBetDate)
                .containsExactly(BASE_DATE.minusDays(4));
        assertThat(last.hasNext()).isFalse();
        assertThat(last.nextCursor()).isNull();
    }

    @Test
    @DisplayName("status 필터 — 정산 결과 3종(SETTLED·REFUNDED·FORFEITED)만 실리고 OPEN·CANCELED 는 빠진다")
    @SuppressWarnings("deprecation") // REFUNDED — 정산이 더는 만들지 않지만 기존 데이터 조회는 계속 다룬다
    void includesSettlementResultsOnlyExcludingOpenAndCanceled() {
        settledBet(GroupBetStatus.SETTLED, BASE_DATE);
        settledBet(GroupBetStatus.REFUNDED, BASE_DATE.minusDays(1));
        settledBet(GroupBetStatus.FORFEITED, BASE_DATE.minusDays(2));
        settledBet(GroupBetStatus.CANCELED, BASE_DATE.minusDays(3));
        // 진행 중(OPEN) 내기 — 아직 결과가 아니라 이력이 아니다.
        bets.add(groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).creatorUser(member)
                .stake(STAKE).betDate(BASE_DATE.plusDays(1)).status(GroupBetStatus.OPEN).build()));

        GroupBetHistorySliceResponse response = history(member.getId(), null, 10);

        assertThat(response.content())
                .extracting(GroupBetHistoryItemResponse::getStatus, GroupBetHistoryItemResponse::getBetDate)
                .containsExactly(
                        tuple(GroupBetStatus.SETTLED, BASE_DATE),
                        tuple(GroupBetStatus.REFUNDED, BASE_DATE.minusDays(1)),
                        tuple(GroupBetStatus.FORFEITED, BASE_DATE.minusDays(2)));
        assertThat(response.hasNext()).isFalse();
    }

    @Test
    @DisplayName("항목 매핑 — betId·settledAt·pot(참가자 수 반영)과 정산 근거(goalMinutes·progressMinutes)가 실린다")
    void mapsEvidenceFieldsIntoHistoryItem() {
        User mate = memberUser("동료");
        GroupChallengeBet bet = settledBet(GroupBetStatus.SETTLED, BASE_DATE);
        participant(bet, member, true, STAKE * 2, GOAL_MINUTES + 15);
        // 미계측(스크린타임 미보고 정산의 형태) — null 이 null 그대로 나와야 앱이 '—' 를 그린다.
        participant(bet, mate, false, 0, null);

        GroupBetHistoryItemResponse item = history(member.getId(), null, 10).content().get(0);

        assertThat(item.getBetId()).isEqualTo(bet.getId());
        assertThat(item.getSettledAt()).isEqualTo(bet.getSettledAt());
        assertThat(item.getStake()).isEqualTo(STAKE);
        assertThat(item.getPot()).isEqualTo(STAKE * 2);
        assertThat(item.getGoalMinutes()).isEqualTo(GOAL_MINUTES);
        assertThat(item.getResults())
                .extracting(r -> r.getUserId(), r -> r.getAchieved(), r -> r.getPayout(),
                        r -> r.getProgressMinutes())
                .containsExactlyInAnyOrder(
                        tuple(member.getId(), true, STAKE * 2, GOAL_MINUTES + 15),
                        tuple(mate.getId(), false, 0, null));
    }

    @Test
    @DisplayName("근거 저장 이전(V29 미만) 정산 건 — goalMinutes·progressMinutes 가 null 로 실린다")
    void exposesNullEvidenceForLegacySettlements() {
        GroupChallengeBet legacy = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).creatorUser(member)
                .stake(STAKE).betDate(BASE_DATE).status(GroupBetStatus.SETTLED)
                .settledAt(Instant.parse("2026-07-31T16:00:00Z"))
                .build());
        bets.add(legacy);
        participant(legacy, member, true, STAKE, null);

        GroupBetHistoryItemResponse item = history(member.getId(), null, 10).content().get(0);

        assertThat(item.getGoalMinutes()).isNull();
        assertThat(item.getResults()).singleElement()
                .satisfies(r -> assertThat(r.getProgressMinutes()).isNull());
    }

    @Test
    @DisplayName("권한 — 비그룹원은 MEMBER_ONLY, 게스트는 GUEST_FORBIDDEN 으로 거절된다")
    void rejectsNonMemberAndGuest() {
        settledBet(GroupBetStatus.SETTLED, BASE_DATE);
        User outsider = plainUser("비그룹원", false);
        User guest = plainUser("게스트", true);

        assertThatThrownBy(() -> history(outsider.getId(), null, 10))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
        assertThatThrownBy(() -> history(guest.getId(), null, 10))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.GUEST_FORBIDDEN));
    }

    @Test
    @DisplayName("size 범위(1~100) 밖은 INVALID_PAGE_REQUEST — Focus 세션 슬라이스와 같은 규칙")
    void rejectsOutOfRangePageSize() {
        assertThatThrownBy(() -> history(member.getId(), null, 0))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.INVALID_PAGE_REQUEST));
        assertThatThrownBy(() -> history(member.getId(), null, 101))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.INVALID_PAGE_REQUEST));
    }

    @Test
    @DisplayName("다른 챌린지의 내기 id 를 커서로 넘기면 BET_NOT_FOUND — 커서는 챌린지 스코프로만 해석된다")
    void rejectsCursorFromAnotherChallenge() {
        settledBet(GroupBetStatus.SETTLED, BASE_DATE);
        GroupChallenge other = durationChallenge();
        GroupChallengeBet foreign = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(other).creatorUser(member)
                .stake(STAKE).betDate(BASE_DATE).status(GroupBetStatus.SETTLED)
                .settledAt(Instant.parse("2026-07-31T16:00:00Z"))
                .build());
        bets.add(foreign);

        assertThatThrownBy(() -> history(member.getId(), foreign.getId(), 10))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_NOT_FOUND));
    }
}
