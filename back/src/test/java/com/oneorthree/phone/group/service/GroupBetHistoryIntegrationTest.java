package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
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
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 내기 히스토리 조회(GROMO-1207) 통합 테스트 — 2계층 재편(GROMO-1262) 기준. keyset 페이지네이션
 * (hasNext/nextCursor)·status 필터(UNUSED·VOIDED·OPEN 제외)·권한(게스트/비그룹원 거절)·미션
 * 스냅샷 필드 매핑을 실 DB 로 고정한다.
 *
 * <p>정산 경로가 근거를 <b>쓰는</b> 것은 {@link GroupBetSettlementIntegrationTest} ·
 * {@link GroupBetCategorySettlementIntegrationTest} 가 고정한다 — 여기는 저장된 근거가 조회로
 * <b>나오는</b> 쪽만 본다.
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
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
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
    private final Map<UUID, GroupChallengeBet> configsByChallengeId = new HashMap<>();
    private final List<GroupChallengeBetSession> betSessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = durationChallenge();
        member = memberUser("그룹원");
    }

    @AfterEach
    void tearDown() {
        // FK 역순 — 다른 테스트 클래스는 @Transactional 롤백이라 여기 남은 행이 곧 오염이다.
        betSessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(betSessions);
        groupChallengeBetRepository.deleteAll(configsByChallengeId.values());
        challenges.forEach(c -> groupChallengeDurationRepository.findById(c.getId())
                .ifPresent(groupChallengeDurationRepository::delete));
        groupChallengeRepository.deleteAll(challenges);
        groupMemberRepository.deleteAll(members);
        userRepository.deleteAll(users);
        groupRepository.delete(group);

        users.clear();
        members.clear();
        challenges.clear();
        configsByChallengeId.clear();
        betSessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private GroupChallenge durationChallenge() {
        GroupChallenge saved = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        challenges.add(saved);
        groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                .challenge(saved).category(MissionCategory.FOCUS).durationMinutes(GOAL_MINUTES).build());
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

    private GroupChallengeBet configOf(GroupChallenge target) {
        return configsByChallengeId.computeIfAbsent(target.getId(),
                id -> groupChallengeBetRepository.save(GroupChallengeBet.builder()
                        .group(group).challenge(target).stake(STAKE).enabled(true).build()));
    }

    private GroupChallengeBetSession sessionOn(
            GroupChallenge target, GroupBetStatus status, LocalDate sessionDate, Integer goalMinutes) {
        GroupChallengeBetSession session = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(configOf(target))
                        .group(group)
                        .challenge(target)
                        .sessionDate(sessionDate)
                        .stake(STAKE)
                        .goalMinutes(goalMinutes)
                        .missionCategory(MissionCategory.FOCUS)
                        .missionType(MissionType.DURATION)
                        .status(status)
                        .startsAt(sessionDate.atStartOfDay(KST).toInstant())
                        .joinClosesAt(sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .closesAt(sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .settleAfter(sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .settledAt(status == GroupBetStatus.OPEN
                                ? null : sessionDate.plusDays(1).atStartOfDay(KST).toInstant())
                        .build());
        betSessions.add(session);
        return session;
    }

    /** 정산이 끝난 회차 — 목표 스냅샷(goalMinutes)은 개설 시점 박제 규약(GROMO-1263)대로 채운다. */
    private GroupChallengeBetSession settledSession(GroupBetStatus status, LocalDate sessionDate) {
        return sessionOn(challenge, status, sessionDate, GOAL_MINUTES);
    }

    private GroupChallengeBetParticipant participant(GroupChallengeBetSession session, User user,
            Boolean achieved, Integer payout, Integer progressMinutes) {
        return groupChallengeBetParticipantRepository.save(GroupChallengeBetParticipant.builder()
                .session(session).user(user).achieved(achieved).payout(payout)
                .progressMinutes(progressMinutes).build());
    }

    private GroupBetHistorySliceResponse history(UUID userId, UUID cursor, int size) {
        return groupBetService.getBetHistory(group.getId(), challenge.getId(), userId, cursor, size);
    }

    // ── 테스트 ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("session_date 내림차순 keyset 페이지네이션 — nextCursor 로 끊김 없이 이어지고 마지막 페이지는 hasNext=false")
    void paginatesBySessionDateDescWithKeysetCursor() {
        for (int i = 0; i < 5; i++) {
            settledSession(GroupBetStatus.SETTLED, BASE_DATE.minusDays(i));
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
    @DisplayName("status 필터 — 정산 결과 3종(SETTLED·REFUNDED·FORFEITED)만 실리고 OPEN·VOIDED·UNUSED 는 빠진다")
    void includesSettlementResultsOnlyExcludingOpenVoidedUnused() {
        settledSession(GroupBetStatus.SETTLED, BASE_DATE);
        settledSession(GroupBetStatus.REFUNDED, BASE_DATE.minusDays(1));
        settledSession(GroupBetStatus.FORFEITED, BASE_DATE.minusDays(2));
        // VOIDED 는 신 API(B8)부터 노출한다 — 구앱은 렌더 분기가 없다.
        settledSession(GroupBetStatus.VOIDED, BASE_DATE.minusDays(3));
        // UNUSED(0명 종료)는 결과가 아니라 어디에도 실리지 않는다(N52).
        settledSession(GroupBetStatus.UNUSED, BASE_DATE.minusDays(4));
        // 진행 중(OPEN) 회차 — 아직 결과가 아니라 이력이 아니다.
        settledSession(GroupBetStatus.OPEN, BASE_DATE.plusDays(1));

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
    @DisplayName("내역에 종료 사유(voidReason)가 실린다 — 24h 미정산 환불과 달성자 0명 환불을 구분(N55)")
    void carriesVoidReasonInHistory() {
        // 시스템이 정산하지 못해 환불된 회차 — 앱이 이걸 "달성한 사람이 없어 환불"로 그리면 거짓말이다.
        LocalDate refundDate = BASE_DATE.minusDays(3);
        Instant closesAt = refundDate.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession deadlineRefund = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(configOf(challenge)).group(group).challenge(challenge)
                        .sessionDate(refundDate).stake(STAKE).goalMinutes(GOAL_MINUTES)
                        .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                        .status(GroupBetStatus.REFUNDED)
                        .voidReason(GroupBetVoidReason.REFUND_DEADLINE)
                        .startsAt(refundDate.atStartOfDay(KST).toInstant())
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .settledAt(closesAt)
                        .build());
        betSessions.add(deadlineRefund);
        // 대비군 — 달성자 0명 몰수(사유 없음).
        settledSession(GroupBetStatus.FORFEITED, BASE_DATE.minusDays(4));

        GroupBetHistorySliceResponse page = history(member.getId(), null, 20);

        // 24h 미정산 환불만 사유가 실리고, 사유 없는 종료는 null 로 구분된다.
        assertThat(page.content())
                .filteredOn(item -> item.getBetDate().equals(refundDate))
                .singleElement()
                .satisfies(item -> assertThat(item.getVoidReason())
                        .isEqualTo(GroupBetVoidReason.REFUND_DEADLINE));
        assertThat(page.content())
                .filteredOn(item -> item.getStatus() == GroupBetStatus.FORFEITED)
                .allSatisfy(item -> assertThat(item.getVoidReason()).isNull());
    }
    @Test
    @DisplayName("항목 매핑 — betId(회차 id)·settledAt·pot(참가자 수 반영)과 근거(goalMinutes·progressMinutes)가 실린다")
    void mapsEvidenceFieldsIntoHistoryItem() {
        User mate = memberUser("동료");
        GroupChallengeBetSession session = settledSession(GroupBetStatus.SETTLED, BASE_DATE);
        participant(session, member, true, STAKE * 2, GOAL_MINUTES + 15);
        // 미계측(스크린타임 미보고 정산의 형태) — null 이 null 그대로 나와야 앱이 '—' 를 그린다.
        participant(session, mate, false, 0, null);

        GroupBetHistoryItemResponse item = history(member.getId(), null, 10).content().get(0);

        assertThat(item.getBetId()).isEqualTo(session.getId());
        assertThat(item.getSettledAt()).isEqualTo(session.getSettledAt());
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
    @DisplayName("스냅샷 이전(V39 백필 전 V29 미만) 정산 건 — goalMinutes·progressMinutes 가 null 로 실린다")
    void exposesNullEvidenceForLegacySettlements() {
        GroupChallengeBetSession legacy = sessionOn(challenge, GroupBetStatus.SETTLED, BASE_DATE, null);
        participant(legacy, member, true, STAKE, null);

        GroupBetHistoryItemResponse item = history(member.getId(), null, 10).content().get(0);

        assertThat(item.getGoalMinutes()).isNull();
        assertThat(item.getResults()).singleElement()
                .satisfies(r -> assertThat(r.getProgressMinutes()).isNull());
    }

    @Test
    @DisplayName("권한 — 비그룹원만 MEMBER_ONLY, 게스트 그룹원은 일반 그룹원과 같은 이력을 본다 (GROMO-1509)")
    void rejectsNonMemberButAllowsGuestMember() {
        settledSession(GroupBetStatus.SETTLED, BASE_DATE);
        User outsider = plainUser("비그룹원", false);

        assertThatThrownBy(() -> history(outsider.getId(), null, 10))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));

        // 게스트도 소셜 로그인 유저와 동일 취급 — 그룹원이기만 하면 막지 않는다
        User guest = plainUser("게스트", true);
        members.add(groupMemberRepository.save(GroupMember.builder()
                .user(guest).group(group).role(GroupMemberRole.MEMBER).build()));

        assertThat(history(guest.getId(), null, 10).content())
                .isNotEmpty()
                .hasSameSizeAs(history(member.getId(), null, 10).content());
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
    @DisplayName("다른 챌린지의 회차 id 를 커서로 넘기면 BET_NOT_FOUND — 커서는 챌린지 스코프로만 해석된다")
    void rejectsCursorFromAnotherChallenge() {
        settledSession(GroupBetStatus.SETTLED, BASE_DATE);
        GroupChallenge other = durationChallenge();
        GroupChallengeBetSession foreign = sessionOn(other, GroupBetStatus.SETTLED, BASE_DATE, GOAL_MINUTES);

        assertThatThrownBy(() -> history(member.getId(), foreign.getId(), 10))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.BET_NOT_FOUND));
    }
}
