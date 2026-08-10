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
import jakarta.persistence.EntityManager;
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
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 창 사용분 보고(GROMO-1407) 통합 회귀 — 실 DB 로 자격의 <b>날짜 결속</b>(N43 · PR #573 codex ②)과
 * measured_at 단조(N34)를 끝까지 태운다:
 * <ul>
 *   <li>탈퇴자(멤버십 없음)가 <b>그 날짜의</b> 시작된 OPEN 회차 참가자면 보고가 성립한다</li>
 *   <li>오늘 회차 참가자가 <b>함께 예약한 미래 회차</b>에 낮은 값을 미리 심으려 하면 조용히 무시된다
 *       — 결속이 없던 시절의 선기록 구멍</li>
 *   <li>정산이 끝난 회차의 지연 도착 보고는 잠금 후 재확인에서 무시된다(정산 불가역)</li>
 *   <li>역전 보고는 저장값을 바꾸지 못하고, 같은 measuredAt 재전송은 멱등이다</li>
 *   <li><b>FR-9 양립</b>: 내기 없는 챌린지·미참가 멤버의 표시용 보고는 그대로 저장된다</li>
 * </ul>
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
    @Autowired
    EntityManager entityManager;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate TODAY = LocalDate.now(KST);
    private static final LocalDate FUTURE = TODAY.plusDays(2);

    /** 내기가 걸린 창 챌린지 — 회차·참가가 붙는다(돈이 걸린 갈래). */
    private GroupChallenge betChallenge;
    /**
     * 내기가 꺼진 창 챌린지 — 회차가 아예 없다(FR-9 표시용 갈래). 같은 (카테고리, 타입) 활성
     * 챌린지는 그룹당 1개(V20 부분 유니크)라 별도 그룹에 둔다.
     */
    private GroupChallenge plainChallenge;

    private Group group;
    private Group plainGroup;
    private GroupChallengeBet config;
    private User member;      // 멤버 · 미참가 — 표시용 보고
    private User bettor;      // 멤버 · 오늘 참가 + 미래 예약
    private User leaver;      // 멤버십 없음 · 오늘 참가 — N43 최종 보고 경로
    private User stranger;    // 멤버십도 참가도 없음

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("보고자격").build());
        plainGroup = groupRepository.save(Group.builder().name("내기없는방").build());
        betChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW).build());
        plainChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(plainGroup).category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW).build());
        config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(betChallenge).stake(30).enabled(true).build());
        member = user("멤버", true);
        bettor = user("참가자", true);
        leaver = user("탈퇴자", false);
        stranger = user("외부인", false);
    }

    @AfterEach
    void tearDown() {
        for (LocalDate date : List.of(TODAY, FUTURE)) {
            groupChallengeMemberRepository.deleteAll(
                    groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(
                            List.of(betChallenge.getId(), plainChallenge.getId()), date));
        }
        sessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(sessions);
        groupChallengeBetRepository.delete(config);
        groupChallengeRepository.deleteAll(List.of(betChallenge, plainChallenge));
        for (Group g : List.of(group, plainGroup)) {
            users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, g)
                    .ifPresent(groupMemberRepository::delete));
        }
        userRepository.deleteAll(users);
        groupRepository.deleteAll(List.of(group, plainGroup));
        users.clear();
        sessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User user(String nickname, boolean withMembership) {
        User saved = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        if (withMembership) {
            groupMemberRepository.save(GroupMember.builder()
                    .user(saved).group(group).role(GroupMemberRole.MEMBER).build());
            groupMemberRepository.save(GroupMember.builder()
                    .user(saved).group(plainGroup).role(GroupMemberRole.MEMBER).build());
        }
        users.add(saved);
        return saved;
    }

    private GroupChallengeBetSession session(LocalDate date, Instant startsAt, GroupBetStatus status) {
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(betChallenge)
                        .sessionDate(date).stake(30).goalMinutes(90)
                        .missionCategory(betChallenge.getCategory())
                        .missionType(betChallenge.getType())
                        .windowStart(LocalTime.of(9, 0)).windowEnd(LocalTime.of(12, 0))
                        .status(status)
                        .startsAt(startsAt)
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .settledAt(status == GroupBetStatus.OPEN ? null : Instant.now())
                        .build());
        sessions.add(saved);
        return saved;
    }

    /** 오늘 회차 — 이미 시작됐다(창 진행 중). */
    private GroupChallengeBetSession startedToday() {
        return session(TODAY, Instant.now().minusSeconds(3600), GroupBetStatus.OPEN);
    }

    /** join-week 로 예약된 미래 회차 — 아직 시작 전이다. */
    private GroupChallengeBetSession reservedFuture() {
        return session(FUTURE, Instant.now().plusSeconds(48 * 3600), GroupBetStatus.OPEN);
    }

    private void join(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private Optional<GroupChallengeMember> storedReport(GroupChallenge challenge, User user, LocalDate date) {
        // 네이티브 upsert 는 영속성 컨텍스트를 우회한다 — 캐시가 아니라 DB 를 본다.
        entityManager.clear();
        return groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), date).stream()
                .filter(row -> row.getUser().getId().equals(user.getId()))
                .findFirst();
    }

    private WindowUsageReportRequest report(LocalDate date, int minutes, Instant measuredAt) {
        return new WindowUsageReportRequest(date, minutes, measuredAt);
    }

    private void reportBet(User user, WindowUsageReportRequest request) {
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), betChallenge.getId(), user.getId(), request);
    }

    // ── 자격의 날짜 결속 (codex ②) ────────────────────────────────────────

    @Test
    @DisplayName("예약된 미래 회차에 선기록 불가 — 오늘 참가자여도 시작 전 날짜 보고는 조용히 무시된다")
    void participantCannotPrePlantOnReservedFutureSession() {
        GroupChallengeBetSession today = startedToday();
        GroupChallengeBetSession future = reservedFuture();
        join(today, bettor);
        join(future, bettor);   // join-week 로 함께 예약 — 종전 구현이 자격을 열어주던 조합이다

        // 미래 회차 날짜에 0분을 미리 심으려는 보고 — 예외 없이(204) 저장만 되지 않는다
        reportBet(bettor, report(FUTURE, 0, Instant.now()));
        assertThat(storedReport(betChallenge, bettor, FUTURE)).isEmpty();

        // 같은 유저의 오늘(시작된 회차) 보고는 정상 저장된다 — 결속은 날짜별로만 닫힌다
        reportBet(bettor, report(TODAY, 45, Instant.now()));
        assertThat(storedReport(betChallenge, bettor, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(45);
        assertThat(future.getId()).isNotNull();
    }

    @Test
    @DisplayName("미참가 멤버도 시작 전 회차에는 못 심는다 — '심어두고 창 시작 전에 참가' 우회 차단")
    void memberCannotPrePlantOnNotStartedSessionThenJoin() {
        GroupChallengeBetSession future = reservedFuture();   // 아직 시작 전 · member 는 미참가

        // 미참가 상태의 선기록 시도 — 표시용 갈래라도 시작 전이면 무시된다
        reportBet(member, report(FUTURE, 0, Instant.now()));
        assertThat(storedReport(betChallenge, member, FUTURE)).isEmpty();

        // 그 뒤 창 시작 전에 참가해도 심어둔 값이 없다 — 정산이 쓸 선기록 자체가 만들어지지 않는다
        join(future, member);
        reportBet(member, report(FUTURE, 0, Instant.now()));
        assertThat(storedReport(betChallenge, member, FUTURE)).isEmpty();
    }

    @Test
    @DisplayName("정산이 끝난 회차의 지연 도착 보고는 무시된다 — 잠금 후 OPEN 재확인(codex ①)")
    void reportOnSettledSessionIsIgnored() {
        GroupChallengeBetSession settled = session(
                TODAY, Instant.now().minusSeconds(7200), GroupBetStatus.SETTLED);
        join(settled, bettor);

        reportBet(bettor, report(TODAY, 10, Instant.now()));

        assertThat(storedReport(betChallenge, bettor, TODAY)).isEmpty();
    }

    // ── N43 탈퇴자 경로 + N34 단조 ────────────────────────────────────────

    @Test
    @DisplayName("탈퇴자 보고 성립(N43) — 그 날짜의 시작된 OPEN 회차 참가자는 멤버십 없이 보고하고, 역전·멱등이 지켜진다")
    void leaverReportsOnStartedOpenSessionWithMonotonicMeasuredAt() {
        GroupChallengeBetSession today = startedToday();
        join(today, leaver);
        Instant t1 = Instant.now().minusSeconds(600);
        Instant t2 = Instant.now().minusSeconds(60);

        // 최종 보고(t2)가 먼저 도착
        reportBet(leaver, report(TODAY, 95, t2));
        assertThat(storedReport(betChallenge, leaver, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(95);

        // 지연 도착한 낮은 옛 값(t1) — 조용히 204, 값 불변. finalize 후 덮어쓰기 구멍이 같은 비교로
        // 닫힌다(중간 보고의 measured_at 은 항상 최종 보고보다 오래됐다).
        reportBet(leaver, report(TODAY, 30, t1));
        GroupChallengeMember row = storedReport(betChallenge, leaver, TODAY).orElseThrow();
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getMeasuredAt()).isEqualTo(t2);

        // 같은 measuredAt 재전송(재시도) — 멱등: 예외도 유실도 없다.
        reportBet(leaver, report(TODAY, 95, t2));
        assertThat(storedReport(betChallenge, leaver, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(95);
    }

    @Test
    @DisplayName("그 날짜에 참가도 멤버십도 없으면 MEMBER_ONLY — 미래 예약만으로는 오늘 자격이 없다")
    void nonMemberWithoutParticipationOnThatDateIsRejected() {
        GroupChallengeBetSession future = reservedFuture();
        join(future, leaver);   // 미래 예약만 있는 탈퇴자

        assertThatThrownBy(() -> reportBet(leaver, report(TODAY, 30, Instant.now())))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);

        assertThatThrownBy(() -> reportBet(stranger, report(TODAY, 30, Instant.now())))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    // ── FR-9 양립 증명 ───────────────────────────────────────────────────

    @Test
    @DisplayName("FR-9 양립 — 내기 없는 챌린지(회차 없음)와 미참가 멤버의 표시용 보고는 그대로 저장된다")
    void displayOnlyReportsSurviveTheParticipantBinding() {
        // ① 내기가 꺼진 챌린지 — 회차가 아예 없다. 엄격 게이트였다면 여기서 죽는다.
        groupBetWindowUsageService.reportWindowUsage(
                plainGroup.getId(), plainChallenge.getId(), member.getId(),
                report(TODAY, 55, Instant.now()));
        assertThat(storedReport(plainChallenge, member, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(55);

        // ② 내기가 걸린 챌린지의 회차가 있어도, 참가하지 않은 멤버의 카드 진행률 보고는 통과한다
        //    (판정은 참가자만 대상이라 돈과 무관하다).
        GroupChallengeBetSession today = startedToday();
        join(today, bettor);
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), betChallenge.getId(), member.getId(),
                report(TODAY, 20, Instant.now()));
        assertThat(storedReport(betChallenge, member, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(20);

        // ③ 미래 날짜라도 회차가 없으면 표시용으로 받는다 — 돈이 걸린 대상이 없다.
        groupBetWindowUsageService.reportWindowUsage(
                plainGroup.getId(), plainChallenge.getId(), member.getId(),
                report(FUTURE, 5, Instant.now()));
        assertThat(storedReport(plainChallenge, member, FUTURE)).isPresent();
    }

    @Test
    @DisplayName("미래 measuredAt 은 참가·표시용 갈래 모두에서 INVALID_MEASURED_AT")
    void futureMeasuredAtIsRejectedOnBothBranches() {
        GroupChallengeBetSession today = startedToday();
        join(today, bettor);

        assertThatThrownBy(() -> reportBet(bettor, report(TODAY, 40, Instant.now().plusSeconds(180))))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_MEASURED_AT);
        assertThatThrownBy(() -> reportBet(member, report(TODAY, 40, Instant.now().plusSeconds(180))))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_MEASURED_AT);
    }
}
