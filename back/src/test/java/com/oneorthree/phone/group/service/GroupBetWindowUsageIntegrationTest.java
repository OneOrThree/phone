package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
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
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 창 사용분 보고(GROMO-1407) 통합 회귀 — 실 DB 로 자격(N43)과 measured_at 단조(N34)를 끝까지
 * 태운다: ① 그룹 멤버십 없는 참가자(탈퇴자)의 보고가 <b>시작된 OPEN 회차</b>에서만 성립하고,
 * ② 역전 보고는 저장값을 바꾸지 못하며(지연 도착 중간 보고 — finalize 후 덮어쓰기 구멍의 재현),
 * ③ 같은 measuredAt 재전송은 멱등이다.
 */
class GroupBetWindowUsageIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetWindowUsageService groupBetWindowUsageService;
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
    GroupChallengeMemberRepository groupChallengeMemberRepository;
    @Autowired
    UserRepository userRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate TODAY = LocalDate.now(KST);

    private Group group;
    private GroupChallenge challenge;
    private GroupChallengeBet config;
    private User member;
    private User leaver;     // 멤버십 없음 + 시작된 OPEN 회차 참가 — 보고 자격 성립(N43)
    private User stranger;   // 멤버십도 참가도 없음 — MEMBER_ONLY

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("보고자격").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW).build());
        config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(30).enabled(true).build());
        member = user("멤버", true);
        leaver = user("탈퇴자", false);
        stranger = user("외부인", false);
    }

    @AfterEach
    void tearDown() {
        groupChallengeMemberRepository.deleteAll(
                groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(
                        List.of(challenge.getId()), TODAY));
        sessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(sessions);
        groupChallengeBetRepository.delete(config);
        groupChallengeRepository.delete(challenge);
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        userRepository.deleteAll(users);
        groupRepository.delete(group);
        users.clear();
        sessions.clear();
    }

    private User user(String nickname, boolean withMembership) {
        User saved = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        if (withMembership) {
            groupMemberRepository.save(GroupMember.builder()
                    .user(saved).group(group).role(GroupMemberRole.MEMBER).build());
        }
        users.add(saved);
        return saved;
    }

    private GroupChallengeBetSession sessionStartingAt(LocalDate date, Instant startsAt) {
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(challenge)
                        .sessionDate(date).stake(30).goalMinutes(90)
                        .missionCategory(challenge.getCategory())
                        .missionType(challenge.getType())
                        .windowStart(LocalTime.of(9, 0)).windowEnd(LocalTime.of(12, 0))
                        .status(GroupBetStatus.OPEN)
                        .startsAt(startsAt)
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .build());
        sessions.add(saved);
        return saved;
    }

    private void join(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private GroupChallengeMember storedReport(User user) {
        return groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), TODAY).stream()
                .filter(row -> row.getUser().getId().equals(user.getId()))
                .findFirst().orElseThrow();
    }

    private WindowUsageReportRequest report(int minutes, Instant measuredAt) {
        return new WindowUsageReportRequest(TODAY, minutes, measuredAt);
    }

    @Test
    @DisplayName("탈퇴자 보고 성립(N43) — 시작된 OPEN 회차 참가자는 멤버십 없이 보고하고, 역전·멱등이 지켜진다")
    void leaverReportsOnStartedOpenSessionWithMonotonicMeasuredAt() {
        GroupChallengeBetSession started = sessionStartingAt(
                TODAY, Instant.now().minusSeconds(3600));
        join(started, leaver);
        Instant t1 = Instant.now().minusSeconds(600);
        Instant t2 = Instant.now().minusSeconds(60);

        // 최종 보고(t2)가 먼저 도착
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), leaver.getId(), report(95, t2));
        assertThat(storedReport(leaver).getProgressMinutes()).isEqualTo(95);

        // 지연 도착한 낮은 옛 값(t1) — 조용히 204(예외 없음), 값 불변. finalize 후 덮어쓰기 구멍이
        // 같은 비교로 닫힌다(중간 보고의 measured_at 이 항상 최종 보고보다 오래됐다).
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), leaver.getId(), report(30, t1));
        GroupChallengeMember row = storedReport(leaver);
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getMeasuredAt()).isEqualTo(t2);

        // 같은 measuredAt 재전송(재시도) — 멱등: 예외도 유실도 없다.
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), leaver.getId(), report(95, t2));
        assertThat(storedReport(leaver).getProgressMinutes()).isEqualTo(95);
    }

    @Test
    @DisplayName("시작 전 예약 회차 참가만으로는 자격이 없다 — '시작된 회차의 참가자'(N43)")
    void reservedFutureSessionDoesNotGrantEligibility() {
        GroupChallengeBetSession future = sessionStartingAt(
                TODAY.plusDays(2), Instant.now().plusSeconds(48 * 3600));
        join(future, leaver);

        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), leaver.getId(), report(30, Instant.now())))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("멤버는 회차 참가와 무관하게 보고 가능(종전 유지) — 외부인은 MEMBER_ONLY, 미래 measuredAt 은 400")
    void memberReportsWithoutParticipationAndGuardsHold() {
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), member.getId(), report(40, Instant.now()));
        assertThat(storedReport(member).getProgressMinutes()).isEqualTo(40);

        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), stranger.getId(), report(40, Instant.now())))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);

        assertThatThrownBy(() -> groupBetWindowUsageService.reportWindowUsage(
                group.getId(), challenge.getId(), member.getId(),
                report(40, Instant.now().plusSeconds(180))))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_MEASURED_AT);
    }
}
