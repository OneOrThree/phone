package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.dto.ChallengeDeletionPreviewResponse;
import com.oneorthree.phone.group.dto.GroupChallengeHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupChallengeHistorySliceResponse;
import com.oneorthree.phone.group.dto.MyBetSessionResponse;
import com.oneorthree.phone.group.dto.MyBetSessionsResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultsResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 챌린지 v2 조회 축(GROMO-1415·1416·1271) 통합 회귀 — 실 DB 로 다음을 고정한다:
 * <ul>
 *   <li><b>탈퇴자 성립</b>(N43·N53): 그룹 멤버십 없는 참가자가 자기 OPEN 회차·정산 결과를 조회한다</li>
 *   <li><b>제외 규칙</b>: 결과 큐에서 삭제된 챌린지의 회차(FR-44-4)·UNUSED(N52) 제외</li>
 *   <li><b>프리뷰</b>(N49): 예약된 미래 OPEN 회차까지 전부 + 총 환불액, 그룹장 전용, IDOR 차단</li>
 *   <li><b>그룹 내역</b>(N6-1): 삭제된 챌린지 회차도 스냅샷으로 조회 + (date, id) 튜플 keyset 경계</li>
 * </ul>
 */
class GroupBetQueryServiceIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetQueryService groupBetQueryService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    UserRepository userRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate TODAY = LocalDate.now(KST);
    private static final int STAKE = 30;

    private Group group;
    private Group otherGroup;
    private GroupChallenge challenge;
    private GroupChallenge deletedChallenge;
    private GroupChallenge otherGroupChallenge;
    private GroupChallengeBet config;
    private GroupChallengeBet deletedConfig;
    private GroupChallengeBet otherConfig;
    private User owner;
    private User member;
    private User leaver;   // 그룹 멤버십 없음 — 탈퇴자 역할(참가 행만 남는다)

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("새벽반").build());
        otherGroup = groupRepository.save(Group.builder().name("남의그룹").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW).build());
        deletedChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        otherGroupChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(otherGroup).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(STAKE).enabled(true).build());
        deletedConfig = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(deletedChallenge).stake(STAKE).enabled(true).build());
        otherConfig = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(otherGroup).challenge(otherGroupChallenge).stake(STAKE).enabled(true).build());
        owner = user("방장", true, GroupMemberRole.OWNER);
        member = user("멤버", true, GroupMemberRole.MEMBER);
        leaver = user("탈퇴자", false, null);
    }

    @AfterEach
    void tearDown() {
        sessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(sessions);
        groupChallengeBetRepository.deleteAll(List.of(config, deletedConfig, otherConfig));
        groupChallengeRepository.deleteAll(List.of(challenge, deletedChallenge, otherGroupChallenge));
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.deleteAll(List.of(group, otherGroup));
        users.clear();
        sessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User user(String nickname, boolean withMembership, GroupMemberRole role) {
        User saved = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        if (withMembership) {
            groupMemberRepository.save(GroupMember.builder().user(saved).group(group).role(role).build());
        }
        users.add(saved);
        return saved;
    }

    private GroupChallengeBetSession sessionOn(GroupChallengeBet betConfig, GroupChallenge target,
            Group owningGroup, LocalDate date, GroupBetStatus status, GroupBetVoidReason voidReason) {
        Instant startsAt = date.atStartOfDay(KST).toInstant();
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(betConfig).group(owningGroup).challenge(target)
                        .sessionDate(date).stake(STAKE).goalMinutes(90)
                        .missionCategory(target.getCategory())
                        .missionType(target.getType())
                        .windowStart(target.getType() == MissionType.TIME_WINDOW ? LocalTime.of(9, 0) : null)
                        .windowEnd(target.getType() == MissionType.TIME_WINDOW ? LocalTime.of(12, 0) : null)
                        .status(status)
                        .voidReason(voidReason)
                        .startsAt(startsAt)
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .settledAt(status == GroupBetStatus.OPEN ? null : Instant.now())
                        .build());
        sessions.add(saved);
        return saved;
    }

    private GroupChallengeBetSession openSession(LocalDate date) {
        return sessionOn(config, challenge, group, date, GroupBetStatus.OPEN, null);
    }

    private GroupChallengeBetParticipant join(GroupChallengeBetSession session, User user) {
        return groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private GroupChallengeBetParticipant joinSettled(GroupChallengeBetSession session, User user,
            boolean achieved, int payout, Integer progressMinutes) {
        GroupChallengeBetParticipant participant = join(session, user);
        participant.recordSettlement(achieved, payout, progressMinutes);
        return groupChallengeBetParticipantRepository.save(participant);
    }

    private GroupChallengeBetParticipant joinRefunded(GroupChallengeBetSession session, User user) {
        GroupChallengeBetParticipant participant = join(session, user);
        participant.recordRefund(STAKE);
        return groupChallengeBetParticipantRepository.save(participant);
    }

    // ── /me/bet-sessions ────────────────────────────────────────────────

    @Test
    @DisplayName("내 OPEN 회차 — 그룹 멤버십 없는 탈퇴자도 자기 회차를 찾고, 미션 스냅샷이 실린다(N43)")
    void myOpenSessionsWorkForLeaverAndCarrySnapshot() {
        GroupChallengeBetSession open = openSession(TODAY);
        GroupChallengeBetSession future = openSession(TODAY.plusDays(2));
        GroupChallengeBetSession settled = sessionOn(
                config, challenge, group, TODAY.minusDays(1), GroupBetStatus.SETTLED, null);
        join(open, leaver);
        join(future, leaver);
        joinSettled(settled, leaver, true, STAKE, 20);
        join(open, member);   // 남의 참가는 남의 응답 — leaver 응답 크기에 영향 없다

        MyBetSessionsResponse response = groupBetQueryService.getMyOpenBetSessions(leaver.getId());

        assertThat(response.sessions()).hasSize(2);
        assertThat(response.sessions()).extracting(MyBetSessionResponse::getSessionId)
                .containsExactly(open.getId(), future.getId());   // 회차일 오름차순
        MyBetSessionResponse first = response.sessions().get(0);
        assertThat(first.getGroupId()).isEqualTo(group.getId());
        assertThat(first.getChallengeId()).isEqualTo(challenge.getId());
        assertThat(first.getMissionCategory()).isEqualTo(MissionCategory.SCREEN_TIME);
        assertThat(first.getMissionType()).isEqualTo(MissionType.TIME_WINDOW);
        assertThat(first.getGoalMinutes()).isEqualTo(90);
        assertThat(first.getWindowStart()).isEqualTo(LocalTime.of(9, 0));
        assertThat(first.getWindowEnd()).isEqualTo(LocalTime.of(12, 0));
        assertThat(first.getClosesAt()).isNotNull();
        assertThat(first.getSettleAfter()).isNotNull();

        // 미참가 유저의 응답은 비어 있다 — 참가자 스코프.
        assertThat(groupBetQueryService.getMyOpenBetSessions(owner.getId()).sessions()).isEmpty();
    }

    // ── /me/challenge-results ───────────────────────────────────────────

    @Test
    @DisplayName("내 결과 — 탈퇴자 성립·4종 status 포함·삭제 챌린지 회차 제외·인별 결과와 pot(N53·FR-44-4)")
    void myChallengeResultsIncludeAllResultStatusesAndExcludeDeletedChallenge() {
        // 정상 챌린지의 정산 4종 — 전부 실려야 한다.
        GroupChallengeBetSession settled = sessionOn(
                config, challenge, group, TODAY.minusDays(1), GroupBetStatus.SETTLED, null);
        joinSettled(settled, leaver, true, 45, 20);
        joinSettled(settled, member, false, 0, 200);
        GroupChallengeBetSession forfeited = sessionOn(
                config, challenge, group, TODAY.minusDays(2), GroupBetStatus.FORFEITED, null);
        joinSettled(forfeited, leaver, false, 0, null);
        joinSettled(forfeited, member, false, 0, null);
        GroupChallengeBetSession voided = sessionOn(config, challenge, group, TODAY.minusDays(3),
                GroupBetStatus.VOIDED, GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS);
        joinRefunded(voided, leaver);
        GroupChallengeBetSession refunded = sessionOn(config, challenge, group, TODAY.minusDays(4),
                GroupBetStatus.REFUNDED, GroupBetVoidReason.REFUND_DEADLINE);
        joinRefunded(refunded, leaver);

        // 삭제된 챌린지 — 무효화 회차도, 삭제 전에 정산된 회차도 결과 큐에서 빠진다(푸시가 알린다).
        GroupChallengeBetSession deletedVoided = sessionOn(deletedConfig, deletedChallenge, group,
                TODAY.minusDays(1), GroupBetStatus.VOIDED, GroupBetVoidReason.CHALLENGE_DELETED);
        joinRefunded(deletedVoided, leaver);
        GroupChallengeBetSession deletedSettled = sessionOn(deletedConfig, deletedChallenge, group,
                TODAY.minusDays(5), GroupBetStatus.SETTLED, null);
        joinSettled(deletedSettled, leaver, true, STAKE, 120);
        deletedChallenge.softDelete();
        groupChallengeRepository.save(deletedChallenge);

        MyChallengeResultsResponse response =
                groupBetQueryService.getMyChallengeResults(leaver.getId(), null, null);

        assertThat(response.results()).extracting(MyChallengeResultResponse::getSessionId)
                .containsExactly(settled.getId(), forfeited.getId(), voided.getId(), refunded.getId());

        MyChallengeResultResponse first = response.results().get(0);
        assertThat(first.getGroupName()).isEqualTo("새벽반");
        assertThat(first.getStatus()).isEqualTo(GroupBetStatus.SETTLED);
        assertThat(first.getMyAchieved()).isTrue();
        assertThat(first.getMyPayout()).isEqualTo(45);
        assertThat(first.getStake()).isEqualTo(STAKE);
        assertThat(first.getPot()).isEqualTo(STAKE * 2);
        assertThat(first.getMissionCategory()).isEqualTo(MissionCategory.SCREEN_TIME);
        assertThat(first.getWindowStart()).isEqualTo(LocalTime.of(9, 0));
        assertThat(first.getResults()).hasSize(2);
        assertThat(first.isChallengeDeleted()).isFalse();

        MyChallengeResultResponse third = response.results().get(2);
        assertThat(third.getStatus()).isEqualTo(GroupBetStatus.VOIDED);
        assertThat(third.getVoidReason()).isEqualTo(GroupBetVoidReason.INSUFFICIENT_PARTICIPANTS);
        assertThat(third.getMyAchieved()).isNull();   // 판정 없는 종료 — "판정 안 됨" 구분 유지
        assertThat(third.getMyPayout()).isEqualTo(STAKE);
    }

    @Test
    @DisplayName("내 결과 — limit 범위 밖은 INVALID_PAGE_REQUEST, limit 은 최신부터 자른다")
    void myChallengeResultsValidatesAndAppliesLimit() {
        for (int i = 1; i <= 3; i++) {
            GroupChallengeBetSession settled = sessionOn(
                    config, challenge, group, TODAY.minusDays(i), GroupBetStatus.SETTLED, null);
            joinSettled(settled, member, true, STAKE, 10);
        }

        assertThat(groupBetQueryService.getMyChallengeResults(member.getId(), null, 2).results())
                .hasSize(2)
                .extracting(MyChallengeResultResponse::getSessionDate)
                .containsExactly(TODAY.minusDays(1), TODAY.minusDays(2));

        assertThatThrownBy(() -> groupBetQueryService.getMyChallengeResults(member.getId(), null, 0))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_PAGE_REQUEST);
        assertThatThrownBy(() -> groupBetQueryService.getMyChallengeResults(member.getId(), null, 11))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_PAGE_REQUEST);
    }

    // ── deletion-preview ────────────────────────────────────────────────

    @Test
    @DisplayName("삭제 프리뷰 — 예약된 미래 회차까지 전부, 인원·적립금·총 환불액이 맞는다(N49)")
    void deletionPreviewCoversFutureSessionsWithTotals() {
        GroupChallengeBetSession today = openSession(TODAY);
        GroupChallengeBetSession future = openSession(TODAY.plusDays(2));
        GroupChallengeBetSession empty = openSession(TODAY.plusDays(4));   // 0명 OPEN — 그대로 보인다
        sessionOn(config, challenge, group, TODAY.minusDays(1), GroupBetStatus.SETTLED, null);   // 정산 완료 제외
        join(today, owner);
        join(today, member);
        join(today, leaver);
        join(future, member);
        join(future, leaver);

        ChallengeDeletionPreviewResponse response =
                groupBetQueryService.getDeletionPreview(group.getId(), challenge.getId(), owner.getId());

        assertThat(response.openSessions()).containsExactly(
                new ChallengeDeletionPreviewResponse.OpenSessionPreview(TODAY, 3, STAKE * 3),
                new ChallengeDeletionPreviewResponse.OpenSessionPreview(TODAY.plusDays(2), 2, STAKE * 2),
                new ChallengeDeletionPreviewResponse.OpenSessionPreview(TODAY.plusDays(4), 0, 0));
        assertThat(response.totalRefund()).isEqualTo(STAKE * 5);
        assertThat(empty.getId()).isNotNull();
    }

    @Test
    @DisplayName("삭제 프리뷰 권한 — 멤버는 NOT_OWNER, 남의 그룹 챌린지 cid 조합은 CHALLENGE_NOT_FOUND(IDOR 차단)")
    void deletionPreviewEnforcesOwnerAndGroupBinding() {
        assertThatThrownBy(() -> groupBetQueryService
                .getDeletionPreview(group.getId(), challenge.getId(), member.getId()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_OWNER);

        // 내가 방장인 그룹 gid + 남의 그룹 챌린지 cid — 그룹 바인딩 조회가 끊는다.
        assertThatThrownBy(() -> groupBetQueryService
                .getDeletionPreview(group.getId(), otherGroupChallenge.getId(), owner.getId()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.CHALLENGE_NOT_FOUND);

        // 멤버십 없는 유저(탈퇴자)는 MEMBER_ONLY — 프리뷰는 그룹 화면의 것이다.
        assertThatThrownBy(() -> groupBetQueryService
                .getDeletionPreview(group.getId(), challenge.getId(), leaver.getId()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    // ── challenge-history ───────────────────────────────────────────────

    @Test
    @DisplayName("그룹 내역 — 삭제 챌린지 회차도 스냅샷으로 실리고(배지), UNUSED 는 빠진다(N6-1·N52)")
    void groupHistoryShowsDeletedChallengeSnapshotAndSkipsUnused() {
        GroupChallengeBetSession settled = sessionOn(
                config, challenge, group, TODAY.minusDays(1), GroupBetStatus.SETTLED, null);
        joinSettled(settled, member, true, 45, 20);
        joinSettled(settled, leaver, false, 0, 200);
        GroupChallengeBetSession deletedVoided = sessionOn(deletedConfig, deletedChallenge, group,
                TODAY.minusDays(2), GroupBetStatus.VOIDED, GroupBetVoidReason.CHALLENGE_DELETED);
        joinRefunded(deletedVoided, member);
        sessionOn(config, challenge, group, TODAY.minusDays(3), GroupBetStatus.UNUSED, null);
        deletedChallenge.softDelete();
        groupChallengeRepository.save(deletedChallenge);

        GroupChallengeHistorySliceResponse response = groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), null, 20, null);

        assertThat(response.content()).extracting(GroupChallengeHistoryItemResponse::getSessionId)
                .containsExactly(settled.getId(), deletedVoided.getId());

        GroupChallengeHistoryItemResponse first = response.content().get(0);
        assertThat(first.isChallengeDeleted()).isFalse();
        assertThat(first.getMissionCategory()).isEqualTo(MissionCategory.SCREEN_TIME);
        assertThat(first.getWindowStart()).isEqualTo(LocalTime.of(9, 0));
        assertThat(first.getPot()).isEqualTo(STAKE * 2);
        assertThat(first.getParticipantCount()).isEqualTo(2);
        assertThat(first.getAchievedCount()).isEqualTo(1);
        // 조회자(member) 관점의 내 결과
        assertThat(first.getMyAchieved()).isTrue();
        assertThat(first.getMyPayout()).isEqualTo(45);
        assertThat(first.getMyProgressMinutes()).isEqualTo(20);

        GroupChallengeHistoryItemResponse second = response.content().get(1);
        assertThat(second.isChallengeDeleted()).isTrue();   // 삭제 배지
        assertThat(second.getChallengeId()).isEqualTo(deletedChallenge.getId());
        assertThat(second.getVoidReason()).isEqualTo(GroupBetVoidReason.CHALLENGE_DELETED);

        // 챌린지 필터 — 삭제된 챌린지로도 조회된다(이력의 소유자는 그룹).
        GroupChallengeHistorySliceResponse filtered = groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), null, 20, deletedChallenge.getId());
        assertThat(filtered.content()).extracting(GroupChallengeHistoryItemResponse::getSessionId)
                .containsExactly(deletedVoided.getId());
    }

    @Test
    @DisplayName("그룹 내역 keyset — 같은 날짜 두 회차가 페이지 경계에서 스킵되지 않는다(튜플 커서)")
    void groupHistoryTupleCursorSurvivesSameDateBoundary() {
        // 같은 날짜에 챌린지 2개의 회차 + 하루 전 회차 — 날짜 단독 커서라면 경계의 같은 날 나머지가 샌다.
        GroupChallengeBetSession a = sessionOn(
                config, challenge, group, TODAY.minusDays(1), GroupBetStatus.SETTLED, null);
        GroupChallengeBetSession b = sessionOn(
                deletedConfig, deletedChallenge, group, TODAY.minusDays(1), GroupBetStatus.SETTLED, null);
        GroupChallengeBetSession c = sessionOn(
                config, challenge, group, TODAY.minusDays(2), GroupBetStatus.SETTLED, null);

        GroupChallengeHistorySliceResponse page1 = groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), null, 1, null);
        assertThat(page1.hasNext()).isTrue();
        GroupChallengeHistorySliceResponse page2 = groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), page1.nextCursor(), 1, null);
        assertThat(page2.hasNext()).isTrue();
        GroupChallengeHistorySliceResponse page3 = groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), page2.nextCursor(), 1, null);

        List<UUID> seen = new ArrayList<>();
        seen.add(page1.content().get(0).getSessionId());
        seen.add(page2.content().get(0).getSessionId());
        seen.add(page3.content().get(0).getSessionId());
        // 같은 날짜 (a, b) 는 id 내림차순으로 둘 다 나오고, 그 다음이 전날 (c) — 스킵도 중복도 없다.
        assertThat(seen).hasSize(3).containsExactlyInAnyOrder(a.getId(), b.getId(), c.getId());
        assertThat(seen.get(2)).isEqualTo(c.getId());
        assertThat(page3.hasNext()).isFalse();
        assertThat(page3.nextCursor()).isNull();
    }

    @Test
    @DisplayName("그룹 내역 가드 — size 범위 밖 400, 타 그룹 커서 404, 비멤버 403")
    void groupHistoryGuards() {
        GroupChallengeBetSession foreign = sessionOn(otherConfig, otherGroupChallenge, otherGroup,
                TODAY.minusDays(1), GroupBetStatus.SETTLED, null);

        assertThatThrownBy(() -> groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), null, 0, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_PAGE_REQUEST);
        assertThatThrownBy(() -> groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), null, 101, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_PAGE_REQUEST);

        // 타 그룹 회차 id 를 커서로 — 임의 날짜 필터 생성 차단(BET_NOT_FOUND).
        assertThatThrownBy(() -> groupBetQueryService
                .getGroupChallengeHistory(group.getId(), member.getId(), foreign.getId(), 10, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.BET_NOT_FOUND);

        // 멤버십 없는 유저(탈퇴자)는 그룹 내역을 못 본다 — 자기 결과는 /me/challenge-results 로 본다.
        assertThatThrownBy(() -> groupBetQueryService
                .getGroupChallengeHistory(group.getId(), leaver.getId(), null, 10, null))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }
}
