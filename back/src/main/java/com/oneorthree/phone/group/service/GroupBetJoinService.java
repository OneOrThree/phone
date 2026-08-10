package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.RepeatSchedule;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.JoinSessionResponse;
import com.oneorthree.phone.group.dto.JoinWeekRequest;
import com.oneorthree.phone.group.dto.JoinWeekResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 신 참여 API 3종(GROMO-1408) — {@code join}(오늘 회차)·{@code join-next}(다음 활성일 1건, N45)·
 * {@code join-week}(주간 부분 예약, N39). 돈이 움직이는 커널(참가 행 + 차감 멱등키)은
 * {@link GroupBetService#stakeIn} 을, 회차 조립(미션 스냅샷 박제)은
 * {@link GroupBetService#newSession} 을 그대로 재사용한다 — 레거시 브리지와 신 경로의 돈 계산이
 * 갈라지면 안 된다.
 *
 * <p><b>잠금 규율(GROMO-1414, 계약 §3)</b>: {@code user(공유) → 멤버십(공유, N54) → 챌린지(FOR
 * SHARE + 활성 재확인) → 회차(id 오름차순, 전부) → 지갑}. 챌린지 공유 락은 종료·삭제의 배타 락
 * (N42)과 직렬화된다 — 삭제가 "OPEN 회차 없음"을 본 뒤 lazy 개설이 끼어들어 삭제된 챌린지에
 * 참가비가 매달리는 창을 없앤다. 다건 잠금 후에는 참가 행을 <b>재조회</b>한다(1258 P0 ③).
 *
 * <p><b>경로 파라미터 검증(IDOR, 8차 리뷰)</b>: 회차는 클라이언트가 id 로 지목하지 않고 (그룹 스코프
 * 검증을 통과한) 챌린지의 설정에서 서버가 파생시킨다 — 다른 그룹의 회차 id 를 끼워 넣을 입력 자체가
 * 없고, 챌린지 id 는 그룹 스코프 조회로 404 가 된다.
 *
 * <p><b>참가 마감(FR-33)</b>: 신 경로는 회차에 박제된 {@code joinClosesAt}(창형 = 창 시작, 하루형 =
 * 회차 종료)을 강제한다 — 창 종료까지 열어 두는 레거시 브리지와 다른 점이다.
 *
 * <p><b>활성 요일(임시 시임)</b>: B1(GROMO-1260)의 {@code repeat_days} 가 이 브랜치 base 에 없어
 * {@link #repeatDaysOf} 가 매일(127)로 고정돼 있다 — B1 머지 후 코디네이터가
 * {@code challenge.getRepeatDays()} 로 배선한다(한 줄).
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class GroupBetJoinService {

    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;
    private final GroupBetService groupBetService;

    // ── 참여 3종 (GROMO-1408) ───────────────────────────────────────────

    /**
     * 오늘 회차 참여 — 회차가 없으면 N35 조건(활성 요일 + 참가 가능 시각) 아래 lazy 개설 후 참가한다.
     * 오늘이 비활성 요일이면 회차가 설 수 없으므로 404({@code BET_NOT_FOUND}) — 그 날의 동선은
     * {@code join-next} 다(N45).
     */
    public JoinSessionResponse joinToday(UUID groupId, UUID challengeId, UUID userId) {
        JoinContext ctx = openJoinContext(groupId, challengeId, userId);
        LocalDate today = GroupBetService.today();
        if (!RepeatSchedule.activeOn(ctx.repeatDays(), today)) {
            throw new GroupException(GroupErrorCode.BET_NOT_FOUND);
        }
        GroupChallengeBetSession session = lockSession(ensureSession(ctx, today));
        requireJoinStillOpen(session);
        if (groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(session.getId(), userId)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_JOINED);
        }
        // 무위험 참가 가드(FR-35)는 진행분이 존재하는 오늘 회차에만 건다. 목표분은 회차 박제값이 기준.
        groupBetService.requireEligibleToStake(targetWithSessionGoal(ctx, session), ctx.user(), today);
        requireBalance(ctx.user(), session.getStake());
        groupBetService.stakeIn(session, ctx.user());
        log.info("내기 오늘 회차 참여 — sessionId={}, challengeId={}, userId={}, stake={}",
                session.getId(), challengeId, userId, session.getStake());
        return joinResponse(session, ctx.user());
    }

    /**
     * 다음 활성일 회차 1건 참여(N45) — 대상은 {@link RepeatSchedule#next}(오늘 제외)다. 회차를 lazy
     * 생성 후 참가하며, 이미 예약했으면 {@code BET_ALREADY_JOINED} 409 (카드가 {@code
     * nextSessionJoined} 로 버튼을 미리 잠근다). 미래 회차라 진행분이 없어 무위험 참가 검사는 하지
     * 않는다. 취소는 예약분 규칙 그대로 회차 시작까지다(N22).
     */
    public JoinSessionResponse joinNext(UUID groupId, UUID challengeId, UUID userId) {
        JoinContext ctx = openJoinContext(groupId, challengeId, userId);
        LocalDate nextDate = RepeatSchedule.next(ctx.repeatDays(), GroupBetService.today());
        GroupChallengeBetSession session = lockSession(ensureSession(ctx, nextDate));
        requireJoinStillOpen(session);
        if (groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(session.getId(), userId)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_JOINED);
        }
        requireBalance(ctx.user(), session.getStake());
        groupBetService.stakeIn(session, ctx.user());
        log.info("내기 다음 회차 예약 — sessionId={}, challengeId={}, userId={}, sessionDate={}, stake={}",
                session.getId(), challengeId, userId, nextDate, session.getStake());
        return joinResponse(session, ctx.user());
    }

    /**
     * 주간 부분 예약(N39) — 이번 주(월~일) 남은 활성일 중 <b>"지금 참여 가능한 미참가 회차"만</b>
     * 골라 회차를 lazy 생성하고 <b>전체를 한 트랜잭션</b>으로 참가시킨다(부분 성공 금지). 마감·자격
     * 가드에 걸린 오늘과 이미 참가한 회차는 조용히 건너뛴다 — 전부-성공-or-전부-실패에 참여 불가능한
     * 오늘을 담으면 오늘 하나 때문에 미래 예약까지 롤백되기 때문이다. 잔액 검사는 <b>총액</b> 기준
     * 선검사({@code BET_INSUFFICIENT_BALANCE})다.
     */
    public JoinWeekResponse joinWeek(UUID groupId, UUID challengeId, UUID userId, JoinWeekRequest request) {
        JoinContext ctx = openJoinContext(groupId, challengeId, userId);
        LocalDate today = GroupBetService.today();
        List<LocalDate> dates = resolveWeekDates(ctx, request, today);

        // 대상 회차 확보(lazy 개설) — 오늘은 N35 시각 조건(창형 = 창 시작 전)을 통과할 때만 담는다.
        List<GroupChallengeBetSession> candidates = new ArrayList<>();
        for (LocalDate date : dates) {
            if (date.equals(today) && !joinableNow(ctx.target(), date)) {
                log.info("join-week 오늘 스킵(N39) — 참가 마감 경과. challengeId={}, userId={}", challengeId, userId);
                continue;
            }
            candidates.add(ensureSession(ctx, date));
        }

        // 회차 id 오름차순 전부 잠금(계약 §3) 후, 잠금 아래에서 참가 가능만 남긴다(P0 ③ 재조회).
        candidates.sort(Comparator.comparing(GroupChallengeBetSession::getId));
        List<GroupChallengeBetSession> targets = new ArrayList<>();
        for (GroupChallengeBetSession candidate : candidates) {
            GroupChallengeBetSession session = lockSession(candidate);
            if (!session.isOpen() || !Instant.now().isBefore(session.getJoinClosesAt())) {
                continue;
            }
            if (groupChallengeBetParticipantRepository
                    .existsBySessionIdAndUserId(session.getId(), userId)) {
                continue;
            }
            if (session.getSessionDate().equals(today)
                    && !eligibleToStakeToday(ctx, session, today)) {
                continue;
            }
            targets.add(session);
        }

        int totalStake = targets.stream().mapToInt(GroupChallengeBetSession::getStake).sum();
        if (!targets.isEmpty()) {
            requireBalance(ctx.user(), totalStake);
            for (GroupChallengeBetSession session : targets) {
                groupBetService.stakeIn(session, ctx.user());
            }
        }
        log.info("내기 주간 예약 — challengeId={}, userId={}, 참가 {}건, totalStake={}",
                challengeId, userId, targets.size(), totalStake);
        return JoinWeekResponse.builder()
                .joined(targets.stream()
                        .sorted(Comparator.comparing(GroupChallengeBetSession::getSessionDate))
                        .map(s -> JoinWeekResponse.JoinedSession.builder()
                                .sessionId(s.getId())
                                .sessionDate(s.getSessionDate())
                                .build())
                        .toList())
                .totalStake(totalStake)
                .balanceAfter(currencyLedgerService.balanceOf(ctx.user()))
                .build();
    }

    // ── 챌린지 생성 시 내기 배선 (GROMO-1410 ②) ─────────────────────────

    /**
     * 챌린지 생성 요청의 {@code bet:{enabled,stake}} 처리 — 설정 생성 + N35 조건(활성 요일 + 참가
     * 가능 시각) 충족 시 <b>당일 회차 개설</b>. {@code GroupChallengeService.createChallenge} 가 생성과
     * <b>같은 트랜잭션</b>에서 부른다(스테이크가 무효면 챌린지 생성째 롤백). 내기는 생성 시에만
     * 결정되고 이후 불변이다(N26 — enabled=false 로 되돌리는 경로가 없다).
     *
     * <p>창 시작이 지난 창형은 오늘을 건너뛴다 — 다음 활성일 회차는 00:05 스케줄러(B4)나 참여
     * lazy 경로가 연다. 개설만 하고 아무도 참가시키지 않는 이유: v2 에서 생성은 참가가 아니다
     * (N14 — 매 회차 직접 결심).
     */
    public void createBetOnChallengeCreation(
            Group group, GroupChallenge challenge, CreateChallengeRequest.BetCreateRequest betRequest) {
        if (betRequest == null || !betRequest.isEnabled()) {
            return;
        }
        Integer stake = betRequest.getStake();
        if (stake == null || stake < GroupBetService.MIN_STAKE || stake > GroupBetService.MAX_STAKE) {
            throw new GroupException(GroupErrorCode.BET_INVALID_STAKE);
        }
        // 방금 생성된 챌린지라 CTI 상세가 이미 영속 컨텍스트에 있다 — 게이트 불통과(창 목표 없음 등)는
        // 생성 검증이 먼저 걸렀으므로 여기 도달하면 결함이다.
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge)
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .stake(stake)
                .enabled(true)
                .build());

        LocalDate today = GroupBetService.today();
        if (RepeatSchedule.activeOn(repeatDaysOf(challenge), today) && joinableNow(target, today)) {
            GroupChallengeBetSession session = groupChallengeBetSessionRepository
                    .save(groupBetService.newSession(bet, group, challenge, target, today));
            log.info("챌린지 생성 시 당일 회차 개설(N35) — sessionId={}, challengeId={}, stake={}",
                    session.getId(), challenge.getId(), stake);
        } else {
            log.info("챌린지 생성 시 당일 회차 미개설(N35 조건 불충족) — challengeId={}, today={}",
                    challenge.getId(), today);
        }
    }

    // ── 공통 진입·회차 확보 ─────────────────────────────────────────────

    /**
     * 참여 경로 공통 진입 — 잠금 순서대로 유저(공유)·멤버십(공유, N54)·챌린지(FOR SHARE + 활성
     * 재확인)를 검증하고, 판정 대상과 내기 설정을 확보한 뒤 <b>스크린타임 권한 가드(N50)</b>를
     * 건다. 권한 가드는 전 경로에서 차감과 같은 트랜잭션, 잔액 검사보다 먼저다 — 보고 수단이 없는
     * 사람이 참가비를 내고 미보고=미달성으로 확정 패배하는 경로를 서버가 끊는다.
     */
    private JoinContext openJoinContext(UUID groupId, UUID challengeId, UUID userId) {
        User user = groupBetService.requireActiveUser(userId);
        Group group = groupBetService.requireGroupMembershipForShare(user, groupId);
        GroupChallenge challenge = groupChallengeRepository
                .findByIdAndGroupAndDeletedAtIsNullForShare(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        if (challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
            throw new GroupException(GroupErrorCode.BET_CHALLENGE_INACTIVE);
        }
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge)
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
        GroupChallengeBet bet = groupChallengeBetRepository.findByChallengeId(challengeId)
                .filter(GroupChallengeBet::isEnabled)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        requireScreenTimePermission(challenge, user);
        return new JoinContext(user, group, challenge, target, bet, repeatDaysOf(challenge));
    }

    /**
     * 회차 확보(lazy 개설, GROMO-1410 ③) — 있으면 그대로, 없으면 미션 스냅샷을 박제해 만든다.
     * 호출 전 챌린지 행 FOR SHARE + 활성 재확인이 끝나 있어야 한다(삭제·종료와의 직렬화).
     * UNIQUE (bet_id, session_date) 가 동시 개설(00:05 스케줄러·레거시 브리지·다른 참여자)을
     * 방어한다 — 위반이면 이긴 쪽 행을 다시 읽는다.
     */
    private GroupChallengeBetSession ensureSession(JoinContext ctx, LocalDate date) {
        return groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(ctx.bet().getId(), date)
                .orElseGet(() -> {
                    try {
                        return groupChallengeBetSessionRepository.saveAndFlush(groupBetService
                                .newSession(ctx.bet(), ctx.group(), ctx.challenge(), ctx.target(), date));
                    } catch (DataIntegrityViolationException e) {
                        // 동시 개설 레이스 패배 — 유니크가 남긴 승자 행으로 진행한다.
                        return groupChallengeBetSessionRepository
                                .findByBetIdAndSessionDate(ctx.bet().getId(), date)
                                .orElseThrow(() -> new IllegalStateException(
                                        "회차 유니크 위반 후 재조회 실패 — betId=" + ctx.bet().getId()
                                                + ", date=" + date, e));
                    }
                });
    }

    /** 회차 행 배타 잠금 재조회 — 다건 잠금은 호출측이 id 오름차순을 보장한다(계약 §3). */
    private GroupChallengeBetSession lockSession(GroupChallengeBetSession session) {
        return groupChallengeBetSessionRepository.findByIdForUpdate(session.getId())
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
    }

    // ── 가드 ────────────────────────────────────────────────────────────

    /** 단건 참여의 마감 가드 — OPEN + 박제 {@code joinClosesAt}(창형 = 창 시작, FR-33) 전만 허용. */
    private void requireJoinStillOpen(GroupChallengeBetSession session) {
        if (!session.isOpen() || !Instant.now().isBefore(session.getJoinClosesAt())) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
    }

    /**
     * 스크린타임 권한 가드(N50, GROMO-1409) — SCREEN_TIME 챌린지의 참여는 서버가 권한 보고값을
     * 확인한다. 설정 행이 없거나 미허용이면 409. FOCUS 는 통과다.
     */
    private void requireScreenTimePermission(GroupChallenge challenge, User user) {
        if (challenge.getCategory() != MissionCategory.SCREEN_TIME) {
            return;
        }
        boolean granted = userScreenTimeSettingsRepository.findById(user.getId())
                .map(UserScreenTimeSettings::isScreenTimePermissionGranted)
                .orElse(false);
        if (!granted) {
            throw new GroupException(GroupErrorCode.BET_SCREENTIME_PERMISSION_REQUIRED);
        }
    }

    /** 총액 선검사(계약 §1) — 부족이면 결정적인 409. 지갑 낙관락·원장 유니크가 최후 방어선이다. */
    private void requireBalance(User user, int totalStake) {
        if (currencyLedgerService.balanceOf(user) < totalStake) {
            throw new GroupException(GroupErrorCode.BET_INSUFFICIENT_BALANCE);
        }
    }

    /**
     * join-week 전용 — 오늘 회차의 무위험 참가 가드(FR-35)를 <b>스킵 판정</b>으로 바꿔 쓴다(N39):
     * 단건 참여라면 409 로 거절할 조건이지만, 주간 배치에서 오늘 하나 때문에 미래 예약까지
     * 롤백되면 안 된다.
     */
    private boolean eligibleToStakeToday(JoinContext ctx, GroupChallengeBetSession session, LocalDate today) {
        try {
            groupBetService.requireEligibleToStake(targetWithSessionGoal(ctx, session), ctx.user(), today);
            return true;
        } catch (GroupException e) {
            log.info("join-week 오늘 스킵(N39) — 자격 가드 {}. sessionId={}, userId={}",
                    e.getErrorCode(), session.getId(), ctx.user().getId());
            return false;
        }
    }

    /**
     * N35 의 "아직 참가 가능한 시각"(회차 행 없이 판정) — 창형은 그 날짜의 창 시작 전, 하루형은
     * 그 날짜가 지나기 전(오늘이면 항상 참)이다. 회차가 이미 있으면 박제 {@code joinClosesAt} 가
     * 같은 값을 준다.
     */
    private boolean joinableNow(GroupBetJudge.Target target, LocalDate date) {
        Instant now = Instant.now();
        return groupBetJudge.windowOpensAt(target, date)
                .map(now::isBefore)
                .orElse(!date.isBefore(GroupBetService.today()));
    }

    /**
     * join-week 대상 날짜 확정 — 지정({@code sessionDates})이 있으면 검증(비어 있지 않은 서로 다른
     * 날짜 + 전부 이번 주 남은 활성일)하고, 없으면 {@link RepeatSchedule#remainingThisWeek} 전부다.
     * 중복·활성일 아님·과거·이번 주 밖은 {@code INVALID_SESSION_DATES} 400 — 조용한 dedup 은 클라
     * 버그를 숨긴다.
     */
    private List<LocalDate> resolveWeekDates(JoinContext ctx, JoinWeekRequest request, LocalDate today) {
        List<LocalDate> week = RepeatSchedule.remainingThisWeek(ctx.repeatDays(), today);
        if (request == null || request.getSessionDates() == null) {
            return week;
        }
        List<LocalDate> requested = request.getSessionDates();
        Set<LocalDate> distinct = new HashSet<>(requested);
        if (requested.isEmpty() || distinct.size() != requested.size() || !week.containsAll(distinct)) {
            throw new GroupException(GroupErrorCode.INVALID_SESSION_DATES);
        }
        return requested.stream().sorted().toList();
    }

    /**
     * 자격 가드용 판정 대상 — 목표분을 회차 박제값(GROMO-1263)으로 덮는다. 챌린지 목표가 개설 후
     * 바뀌어도 이 회차의 기준은 불변이어야 참가 가드와 정산이 같은 기준을 쓴다.
     */
    private GroupBetJudge.Target targetWithSessionGoal(JoinContext ctx, GroupChallengeBetSession session) {
        return session.getGoalMinutes() == null
                ? ctx.target()
                : new GroupBetJudge.Target(ctx.target().challenge(), session.getGoalMinutes(),
                        ctx.target().window());
    }

    /**
     * 챌린지의 활성 요일 마스크 — <b>B1(GROMO-1260) 머지 전 임시 시임</b>. base 에 {@code repeat_days}
     * 컬럼이 없어 매일(127)로 고정한다. 머지 시 코디네이터가 {@code challenge.getRepeatDays()} 로
     * 배선한다(이 메서드 한 줄).
     */
    private int repeatDaysOf(GroupChallenge challenge) {
        return RepeatSchedule.EVERYDAY;
    }

    private JoinSessionResponse joinResponse(GroupChallengeBetSession session, User user) {
        return JoinSessionResponse.builder()
                .sessionId(session.getId())
                .sessionDate(session.getSessionDate())
                .stake(session.getStake())
                .balanceAfter(currencyLedgerService.balanceOf(user))
                .build();
    }

    /** 참여 경로 공통 컨텍스트 — 잠금·검증을 통과한 유저/그룹/챌린지/판정 대상/설정 묶음. */
    private record JoinContext(User user, Group group, GroupChallenge challenge,
            GroupBetJudge.Target target, GroupChallengeBet bet, int repeatDays) {
    }
}
