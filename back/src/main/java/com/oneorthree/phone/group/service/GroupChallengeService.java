package com.oneorthree.phone.group.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.domain.RepeatSchedule;
import com.oneorthree.phone.group.dto.ChallengeMemberProgressResponse;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.RepeatDay;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupBetResultResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupChallengeService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final GroupChallengeMemberRepository groupChallengeMemberRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final GroupBetService groupBetService;
    private final GroupBetSettler groupBetSettler;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    // 진행률·달성 판정의 단일 커널(GROMO-1280) — 카드가 통계 테이블을 직접 읽지 않는다.
    private final GroupBetJudge groupBetJudge;
    private final ApplicationEventPublisher eventPublisher;

    /** activeToday 등 요일 판정의 시간대 — 정책은 저장축까지 KST 고정이다(§B3 · N8). */
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static final int MAX_WINDOW_USAGE_MINUTES = 1_440;
    /**
     * 일 목표(DURATION) 카테고리별 상한(N51 · §A6-bis) — FOCUS 는 물리적 최대치 근처(18h),
     * SCREEN_TIME 은 "이하가 목표"라 상한이 곧 가장 느슨한 목표(12h). DB 는 V36 카테고리별 CHECK 가
     * 같은 값으로 최후 방어한다.
     */
    private static final int MAX_FOCUS_DURATION_GOAL_MINUTES = 1_080;
    private static final int MAX_SCREEN_TIME_DURATION_GOAL_MINUTES = 720;
    /** 창형 SCREEN_TIME 목표 눈금(§A6-3) — 스크린타임 측정 최소 단위 15분의 배수만 받는다. */
    private static final int SCREEN_TIME_GOAL_STEP_MINUTES = 15;
    /** 그룹당 활성 챌린지 상한(FR-1 · §A4) — 그룹 행 배타 락 아래의 사전 검사로 강제한다. */
    private static final int MAX_ACTIVE_CHALLENGES = 4;

    /**
     * 그룹 챌린지 목록. {@code date} 를 주면 멤버별 당일 진행률({@code memberProgress})을 함께 채운다.
     *
     * @param date 클라 로컬 타임존 기준 오늘(그룹 상세의 focusTimeMinutes 와 같은 의미).
     *             null 이면 진행률을 계산하지 않는다(기존 클라이언트 호환).
     */
    public List<GroupChallengeResponse> getChallenges(UUID groupId, UUID userId, LocalDate date) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        boolean screenTimePermissionGranted = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::isScreenTimePermissionGranted)
                .orElse(false);

        List<GroupChallenge> challenges =
                groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group);
        if (challenges.isEmpty()) {
            return List.of();
        }

        // N+1 방지: type 별 상세(duration/window)를 IN 절로 배치 로드해 challengeId 맵으로 조합
        List<UUID> challengeIds = challenges.stream().map(GroupChallenge::getId).toList();
        Map<UUID, GroupChallengeDuration> durations = groupChallengeDurationRepository
                .findByChallengeIdIn(challengeIds).stream()
                .collect(Collectors.toMap(GroupChallengeDuration::getChallengeId, Function.identity()));
        Map<UUID, GroupChallengeWindow> windows = groupChallengeWindowRepository
                .findByChallengeIdIn(challengeIds).stream()
                .collect(Collectors.toMap(GroupChallengeWindow::getChallengeId, Function.identity()));

        // 판정 대상(목표·창 시각)은 커널이 해석한다(GROMO-1280) — 진행률·달성 규칙을 카드가 따로
        // 갖지 않는다. 상세는 위에서 배치 로드한 맵을 넘겨 조회가 늘지 않게 한다.
        Map<UUID, GroupBetJudge.Target> targets = judgeTargets(challenges, durations, windows);

        // 비활성 요일(FR-9 · §A3)은 판정 대상에서 뺀다 — 통계 조회도, myAchievedNow 도, 달성 칩도
        // 그날 도는 챌린지에만 선다. 대상에서 빠진 챌린지는 "판정 불가(null)"로 나간다.
        Map<UUID, GroupBetJudge.Target> activeTargets = activeOnDate(challenges, targets, date);

        // 멤버·일별 통계도 챌린지 루프 밖에서 한 번씩만 로드한다(챌린지 수 × 멤버 수의 N+1 방지).
        ProgressSnapshot progress = loadProgressSnapshot(group, activeTargets, date);

        // 내기(오늘 것 + 지난 정산 1건)도 챌린지 목록 전체를 IN 절로 한 번에 읽는다.
        Map<UUID, GroupBetResponse> bets = groupBetService.loadCurrentBets(
                challengeIds, date, userId, myAchievedByChallengeId(activeTargets, progress, userId));
        Map<UUID, GroupBetResultResponse> lastSettledBets = groupBetService.loadLastSettledBets(challengeIds);

        // 휴면 배지(GROMO-1201) — 이력·OPEN 보유 챌린지 id 를 각각 IN 절 1회로 배치 조회한다(N+1 없음).
        // OPEN 판정을 요청 date 스코프의 bets 맵에 얹지 않는 이유: 요청 날짜가 서버 KST 내기 날짜와
        // 다르면(기기 로컬 오늘, 결과 모달의 과거 날짜 조회) 오늘의 OPEN 내기가 맵에 없어 참가 가능한
        // 챌린지를 휴면으로 오판한다. 날짜 무관 status 조회라 date 없는 하위 호환 조회에서도 계산한다
        // (구클라는 dormant 필드를 몰라 무해).
        Set<UUID> challengeIdsWithBetHistory =
                Set.copyOf(groupChallengeBetRepository.findChallengeIdsWithAnyBet(challengeIds));
        Set<UUID> challengeIdsWithOpenBet =
                Set.copyOf(groupChallengeBetRepository.findChallengeIdsWithOpenBet(challengeIds));

        // activeToday 기준일 — 계약상 date 는 클라의 KST 오늘이다. 미전송(구앱)이면 서버 KST 오늘.
        LocalDate activeAnchorDate = date != null ? date : LocalDate.now(KST);

        return challenges.stream()
                .map(c -> {
                    GroupChallengeDuration duration = durations.get(c.getId());
                    GroupChallengeWindow window = windows.get(c.getId());
                    return GroupChallengeResponse.builder()
                            .id(c.getId())
                            .missionType(c.getType())
                            .missionCategory(c.getCategory())
                            .durationMinutes(durationMinutesOf(duration, window))
                            .repeatDays(RepeatDay.listOf(c.getRepeatDays()))
                            .activeToday(RepeatSchedule.activeOn(c.getRepeatDays(), activeAnchorDate))
                            .windowStart(window != null ? toLocalTimeString(window.getWindowStart()) : null)
                            .windowEnd(window != null ? toLocalTimeString(window.getWindowEnd()) : null)
                            .canParticipate(c.getCategory() == MissionCategory.FOCUS
                                    || screenTimePermissionGranted)
                            .status(c.getStatus())
                            .startedAt(c.getStartedAt())
                            .createdAt(c.getCreatedAt())
                            .memberProgress(memberProgressOf(targets.get(c.getId()), progress,
                                    activeTargets.containsKey(c.getId())))
                            .bet(bets.get(c.getId()))
                            .lastSettledBet(lastSettledBets.get(c.getId()))
                            .dormant(challengeIdsWithBetHistory.contains(c.getId())
                                    && !challengeIdsWithOpenBet.contains(c.getId()))
                            .build();
                })
                .toList();
    }

    /** 응답 durationMinutes — DURATION 은 일 목표, TIME_WINDOW 는 창 내 목표(V20, 목표 없는 구 창은 null). */
    private Integer durationMinutesOf(GroupChallengeDuration duration, GroupChallengeWindow window) {
        if (duration != null) {
            return duration.getDurationMinutes();
        }
        return window != null ? window.getDurationMinutes() : null;
    }

    /**
     * 판정 대상(목표·창 시각) 해석 — ACTIVE 이고 목표가 있는 챌린지만 대상이 된다. 규칙은
     * {@link GroupBetJudge#targetOf} 하나뿐이라 "무엇을 판정 대상으로 볼 것인가"가 카드와 내기에서
     * 갈리지 않는다.
     *
     * <p>INACTIVE 를 빼는 이유는 이미 끝난 챌린지이기 때문이다(V2 마이그레이션이 레거시 {@code ENDED}
     * 행을 INACTIVE 로 보존). 조회한 날짜의 "현재" 통계를 끝난 챌린지 목표와 대조하면 과거 챌린지의
     * 진행률·달성 여부가 매일 바뀌어 보이고, 활동 기간(ended_at)이 없어 당시 진행률을 복원할 수도 없다.
     */
    private Map<UUID, GroupBetJudge.Target> judgeTargets(List<GroupChallenge> challenges,
            Map<UUID, GroupChallengeDuration> durations, Map<UUID, GroupChallengeWindow> windows) {
        Map<UUID, GroupBetJudge.Target> targets = new LinkedHashMap<>();
        for (GroupChallenge challenge : challenges) {
            if (challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
                continue;
            }
            GroupBetJudge.targetOf(challenge, durations.get(challenge.getId()),
                            windows.get(challenge.getId()))
                    .ifPresent(target -> targets.put(challenge.getId(), target));
        }
        return targets;
    }

    /**
     * 요청 날짜에 <b>실제로 도는</b>(활성 요일) 판정 대상만 추린다(FR-9 · §A3 · GROMO-1260).
     * 진행률 통계 조회·{@code myAchievedNow}·달성 칩이 전부 이 맵을 기준으로 삼는다 — 쉬는 날에
     * 통계를 재면 "안 도는 날인데 미달성" 이 화면에 뜨고, 그날 조회가 필요 없는 테이블까지 훑는다.
     *
     * <p>{@code date} 가 없으면(구클라 하위 호환) 진행률 자체를 계산하지 않으므로 빈 맵이다.
     */
    private Map<UUID, GroupBetJudge.Target> activeOnDate(List<GroupChallenge> challenges,
            Map<UUID, GroupBetJudge.Target> targets, LocalDate date) {
        if (date == null) {
            return Map.of();
        }
        Map<UUID, GroupBetJudge.Target> active = new LinkedHashMap<>();
        for (GroupChallenge challenge : challenges) {
            GroupBetJudge.Target target = targets.get(challenge.getId());
            if (target != null && RepeatSchedule.activeOn(challenge.getRepeatDays(), date)) {
                active.put(challenge.getId(), target);
            }
        }
        return active;
    }

    /**
     * 챌린지별 "나는 지금 달성 상태인가" — 내기 UI 표시({@code myAchievedNow})용. 판정은
     * {@link GroupBetJudge#isAchieved}(확정 판)로, 참가 가드가 쓰는 것과 <b>같은 함수</b>다 —
     * 화면이 "달성"이라 표시했는데 서버가 참가를 허용하는(또는 그 반대) 어긋남이 생길 수 없다.
     *
     * <p><b>카테고리마다 의미가 다르다</b>:
     * <ul>
     *   <li><b>FOCUS</b> = <b>확정</b> 달성. DURATION 은 일 통계, TIME_WINDOW 는 창 클리핑 집계(5분
     *       관용치) 기준이고 둘 다 서버 데이터라 한 번 달성하면 뒤집히지 않는다. 그래서 내기 참가
     *       가드가 이 의미 그대로 {@code BET_ALREADY_ACHIEVED} 로 무위험 참가를 막는다</li>
     *   <li><b>SCREEN_TIME</b> = <b>잠정</b> 달성(현재 계측값 ≤ 목표). 하루/창이 끝나야 확정되므로
     *       이후 사용으로 얼마든지 뒤집힌다 — <b>표시용일 뿐 참가 차단 근거가 아니다</b>(참가 가드는
     *       반대 방향으로 "이미 초과 = 확정 패배"만 {@code BET_ALREADY_FAILED} 로 막는다,
     *       {@link GroupBetService#requireEligibleToStake})</li>
     * </ul>
     *
     * <p>이미 로드해 둔 진행률 스냅샷을 재사용해 통계 조회가 늘지 않는다(진행률 미계산이면 빈 맵 → 판정 없음).
     */
    private Map<UUID, Boolean> myAchievedByChallengeId(
            Map<UUID, GroupBetJudge.Target> activeTargets, ProgressSnapshot progress, UUID userId) {
        if (progress == null) {
            return Map.of();
        }
        // 비활성 요일 챌린지는 activeTargets 에서 이미 빠졌다(FR-9) — 맵에 없으면 myAchievedNow 가
        // null(판정 불가)로 나간다.
        Map<UUID, Boolean> achieved = new LinkedHashMap<>();
        activeTargets.forEach((challengeId, target) -> achieved.put(challengeId,
                GroupBetJudge.isAchieved(target, progress.minutesOf(challengeId).get(userId))));
        return achieved;
    }

    /**
     * 진행률 계산에 필요한 멤버와 <b>커널 판정 진행분</b>을 배치 로드한다. {@code date} 가 없으면
     * null 을 반환해 호출측이 {@code memberProgress = null}(미계산)로 응답하게 한다.
     *
     * <p>진행분 조회는 대상 챌린지마다 {@link GroupBetJudge#progressMinutes} 한 번이다 — 활성
     * 챌린지는 (카테고리 × 방식)당 1개(V20)라 조합 수(≤4)가 상한이고, 종전의 조합별 배치 조회와
     * 쿼리 수가 같다. FOCUS 챌린지만 있는 그룹이 스크린타임 테이블을 훑지 않는 성질도 그대로다
     * (대상이 없으면 그 조합의 조회 자체가 일어나지 않는다).
     *
     * <p>대상은 {@link #activeOnDate} 가 추린 <b>그날 도는</b> 챌린지뿐이다(FR-9) — 쉬는 날 챌린지는
     * 통계 조회조차 하지 않는다.
     */
    private ProgressSnapshot loadProgressSnapshot(
            Group group, Map<UUID, GroupBetJudge.Target> activeTargets, LocalDate date) {
        if (date == null) {
            return null;
        }

        // 탈퇴자 제외(GROMO-1220) — 진행률 행이 그룹 상세 멤버 목록과 같은 인원이어야 한다.
        // 탈퇴자 통계는 이미 nullify(익명화)돼 값도 없다 — 빈 닉네임에 null 진행률 행만 남던 것을 걷어낸다.
        List<GroupMember> members = groupMemberRepository.findByGroup(group).stream()
                .filter(member -> !member.getUser().isDeleted())
                .toList();
        List<User> users = members.stream().map(GroupMember::getUser).toList();
        if (users.isEmpty()) {
            return new ProgressSnapshot(members, Map.of());
        }

        Map<UUID, Map<UUID, Integer>> minutesByChallenge = new LinkedHashMap<>();
        activeTargets.forEach((challengeId, target) -> minutesByChallenge.put(
                challengeId, groupBetJudge.progressMinutes(target, date, users)));
        return new ProgressSnapshot(members, minutesByChallenge);
    }

    /** 스크린타임 권한에 동의한 유저 id 집합 — 개설 시 비참여자 안내 목록이 쓰는 기준. */
    private Set<UUID> grantedScreenTimeUserIds(List<User> users) {
        return userScreenTimeSettingsRepository.findAllById(users.stream().map(User::getId).toList()).stream()
                .filter(UserScreenTimeSettings::isScreenTimePermissionGranted)
                .map(UserScreenTimeSettings::getUserId)
                .collect(Collectors.toSet());
    }

    /**
     * 챌린지 하나에 대한 멤버별 진행률. 진행률 미계산(date 없음)·판정 대상 아님(목표 없는 창·INACTIVE·
     * 상세 행 유실)이면 null 이다.
     *
     * <p>표시 규칙은 커널이 쥔다(GROMO-1280): 실측 분은 {@link GroupBetJudge#displayMinutes},
     * 달성 칩은 3상 {@link GroupBetJudge#achievedOrNull} 이다 — FOCUS 는 무기록이 "0분"이라 값이 서고,
     * SCREEN_TIME 의 미계측(미보고·권한 철회)은 {@code null}("—")로 남아 0분 사용과 구분된다(§B7).
     * 정산이 쓰는 {@link GroupBetJudge#isAchieved} 는 이 3상의 null 을 FR-21 대로 미달성으로 닫는
     * <b>같은 함수의 확정판</b>이라, 카드가 "—" 인 멤버는 정산에서 반드시 미달성이 된다.
     */
    private List<ChallengeMemberProgressResponse> memberProgressOf(
            GroupBetJudge.Target target, ProgressSnapshot progress, boolean activeToday) {
        if (progress == null || target == null) {
            return null;
        }

        // 비활성 요일에는 진행률을 재지 않는다(FR-9 · §A3). 멤버 행은 유지하되 progressMinutes·achieved 를
        // 전원 null(판정 불가 3상)로 내보낸다 — 구앱은 null 을 '—'(미집계)로 렌더하므로 shape 안전.
        // 통계도 loadProgressSnapshot 이 같은 기준(activeTargets)으로 아예 조회하지 않는다.
        if (!activeToday) {
            return progress.members().stream()
                    .map(member -> ChallengeMemberProgressResponse.builder()
                            .userId(member.getUser().getId())
                            .nickname(member.getUser().getNickname())
                            .progressMinutes(null)
                            .achieved(null)
                            .build())
                    .toList();
        }

        Map<UUID, Integer> minutes = progress.minutesOf(target.challengeId());
        return progress.members().stream()
                .map(member -> {
                    UUID memberId = member.getUser().getId();
                    Integer measured = minutes.get(memberId);
                    return ChallengeMemberProgressResponse.builder()
                            .userId(memberId)
                            .nickname(member.getUser().getNickname())
                            .progressMinutes(GroupBetJudge.displayMinutes(target, measured))
                            .achieved(GroupBetJudge.achievedOrNull(target, measured))
                            .build();
                })
                .toList();
    }

    /**
     * 진행률 계산용 배치 로드 결과 — 그룹 멤버 전원과 challengeId → (userId → 커널 진행분) 맵.
     * 값이 없는 유저는 키가 없다(3상의 "미계측/무기록" — 해석은 커널이 한다).
     */
    private record ProgressSnapshot(
            List<GroupMember> members,
            Map<UUID, Map<UUID, Integer>> minutesByChallenge) {

        Map<UUID, Integer> minutesOf(UUID challengeId) {
            return minutesByChallenge.getOrDefault(challengeId, Map.of());
        }
    }

    @Transactional
    public CreateChallengeResponse createChallenge(UUID groupId, UUID userId, CreateChallengeRequest request) {
        User user = requireActiveUser(userId);

        // 그룹 행 배타 락(LLD §2.1 · GROMO-1422) — 활성 4개 상한·창 겹침은 그룹 전역 불변식이라
        // 생성끼리 직렬화해야 지켜진다. 동시 생성 2건이 둘 다 "3개네" 하고 통과하면 5개째가 들어온다.
        Group group = groupRepository.findByIdForUpdate(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        Optional<GroupMember> groupMember = groupMemberRepository.findByUserAndGroup(user, group);
        if (groupMember.isEmpty()) {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
        if (groupMember.get().getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        // 요일 집합(§A3 · GROMO-1260) — 신앱 빈 배열은 400(기본값 없음), 구앱 미전송(null)만 매일로.
        int repeatDaysMask = resolveRepeatDaysMask(request);

        // 그룹당 활성 챌린지 4개 상한(FR-1 · GROMO-1422) — 그룹 행 락 아래라 사전 검사가 결정적이다.
        if (groupChallengeRepository.countByGroupAndStatusAndDeletedAtIsNull(group, GroupChallengeStatus.ACTIVE)
                >= MAX_ACTIVE_CHALLENGES) {
            throw new GroupException(GroupErrorCode.CHALLENGE_LIMIT_EXCEEDED);
        }

        // TIME_WINDOW 창 시각 — 요청 문자열을 KST 벽시계 시각으로 파싱한 결과(DURATION 이면 null 유지).
        LocalTime windowStart = null;
        LocalTime windowEnd = null;
        if (request.getMissionType() == MissionType.DURATION) {
            // 하루형만 카테고리당 활성 1개(FR-3 · V36 부분 유니크) — 창형은 겹침 검사만 통과하면 복수 허용.
            if (groupChallengeRepository.existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
                    group, request.getMissionCategory(), MissionType.DURATION, GroupChallengeStatus.ACTIVE)) {
                throw new GroupException(GroupErrorCode.CHALLENGE_DUPLICATE);
            }
            validateDurationGoal(request.getMissionCategory(), request.getDurationMinutes());
        } else if (request.getMissionType() == MissionType.TIME_WINDOW) {
            windowStart = parseWindowTimeParam(request.getWindowStart());
            windowEnd = parseWindowTimeParam(request.getWindowEnd());
            validateTimeWindowParams(
                    request.getMissionCategory(), windowStart, windowEnd, request.getDurationMinutes());
            rejectWindowOverlap(group, windowStart, windowEnd);
        } else {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }

        GroupChallenge savedChallenge;
        try {
            savedChallenge = groupChallengeRepository.saveAndFlush(GroupChallenge.builder()
                    .group(group)
                    .type(request.getMissionType())
                    .category(request.getMissionCategory())
                    .repeatDays(repeatDaysMask)
                    .build());
        } catch (DataIntegrityViolationException e) {
            // 사전 검사와 동시 생성이 겹친 레이스 — 부분 유니크(활성 하루형 카테고리당 1개, V36) 위반으로
            // 강하. 그룹 행 락으로 생성끼리는 직렬화돼 있어 실전 경로는 사실상 사전 검사가 다 잡는다.
            throw new GroupException(GroupErrorCode.CHALLENGE_DUPLICATE);
        }

        // CTI 상세: type 별 파라미터를 전용 테이블에 저장 (@MapsId 로 challenge_id 공유)
        if (request.getMissionType() == MissionType.DURATION) {
            groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                    .challenge(savedChallenge)
                    // 부모 카테고리 비정규화 복사(V36) — 복합 FK 가 부모와의 일치를 보증한다.
                    .category(request.getMissionCategory())
                    .durationMinutes(request.getDurationMinutes())
                    .build());
        } else {
            groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                    .challenge(savedChallenge)
                    .windowStart(windowStart)
                    .windowEnd(windowEnd)
                    .durationMinutes(request.getDurationMinutes())
                    .build());
        }

        List<CreateChallengeResponse.NonParticipantDto> nonParticipants;
        if (request.getMissionCategory() == MissionCategory.SCREEN_TIME) {
            // 탈퇴자 제외(GROMO-1220) — 미참여자 안내는 라이브 멤버 대상이다(탈퇴자는 독려 대상이 아니다).
            List<User> members = groupMemberRepository.findByGroup(group).stream()
                    .map(GroupMember::getUser)
                    .filter(u -> !u.isDeleted())
                    .toList();
            Set<UUID> grantedUserIds = grantedScreenTimeUserIds(members);
            nonParticipants = members.stream()
                    .filter(u -> !grantedUserIds.contains(u.getId()))
                    .map(u -> CreateChallengeResponse.NonParticipantDto.builder()
                            .userId(u.getId())
                            .nickname(u.getNickname())
                            .build())
                    .toList();
        } else {
            nonParticipants = List.of();
        }

        // 그룹원 개설 알림(GROMO-1089) — 발송은 알림 도메인이 AFTER_COMMIT 으로 받아 처리한다.
        // 여기서 직접 푸시를 부르지 않는 이유: 이 트랜잭션이 뒤에서 롤백되면 챌린지는 없는데 알림만
        // 나간 상태가 되기 때문이다. 이벤트 발행은 커밋되지 않으면 리스너까지 가지 않는다.
        eventPublisher.publishEvent(new GroupChallengeCreatedEvent(
                savedChallenge.getId(), group.getId(), userId));

        return CreateChallengeResponse.builder()
                .id(savedChallenge.getId())
                .nonParticipants(nonParticipants)
                .build();
    }

    /**
     * 요청의 요일 목록 → repeat_days 마스크(§A3 · GROMO-1260).
     *
     * <ul>
     *   <li>미전송(null) = 구앱 — 요일 개념이 없던 시절의 "매일"(127)로 관대하게 접는다</li>
     *   <li>빈 배열 = 신앱이 선택을 안 한 것 — 기본값 없음 원칙대로 400
     *       ({@code CHALLENGE_REPEAT_DAYS_REQUIRED})</li>
     * </ul>
     */
    private int resolveRepeatDaysMask(CreateChallengeRequest request) {
        if (request.getRepeatDays() == null) {
            return RepeatSchedule.EVERYDAY;
        }
        // Jackson 은 [null] 원소를 통과시킨다 — 비트 접기 전에 거르지 않으면 NPE 500 이 된다.
        // 의미상 "요일을 안 고른 것"과 같으므로 빈 배열과 동일하게 400 으로 수렴시킨다.
        // contains(null) 은 List.of 계열(불변 리스트)에서 그 자체로 NPE 라 스트림 스캔으로 거른다.
        if (request.getRepeatDays().stream().anyMatch(Objects::isNull)) {
            throw new GroupException(GroupErrorCode.CHALLENGE_REPEAT_DAYS_REQUIRED);
        }
        int mask = RepeatDay.maskOf(request.getRepeatDays());
        if (!RepeatSchedule.isValidMask(mask)) {
            throw new GroupException(GroupErrorCode.CHALLENGE_REPEAT_DAYS_REQUIRED);
        }
        return mask;
    }

    /**
     * 하루형(DURATION) 목표 검증 — 0 < x ≤ 카테고리별 상한(N51 · §A6-bis). FOCUS 1,080분(18h) ·
     * SCREEN_TIME 720분(12h). 방향이 반대인 지표라 상한도 갈린다 — SCREEN_TIME 상한은 곧 가장
     * 느슨한 목표다. DB 는 V36 카테고리별 CHECK 가 같은 값으로 최후 방어한다.
     */
    private void validateDurationGoal(MissionCategory category, Integer goal) {
        int cap = category == MissionCategory.SCREEN_TIME
                ? MAX_SCREEN_TIME_DURATION_GOAL_MINUTES
                : MAX_FOCUS_DURATION_GOAL_MINUTES;
        if (goal == null || goal <= 0 || goal > cap) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
    }

    /**
     * 창 시각 요청 파라미터 파싱 — "HH:mm:ss"(신앱)·ISO Instant(구앱) 이중 수용(GROMO-1225).
     * 실제 해석은 {@link WindowFocusAggregator#parseRequestTime} 단일 입구가 하고, 여기서는 누락(null)과
     * 형식 오류를 기존 INVALID_MISSION_PARAMS 로 매핑만 한다(신규 에러 코드 없음).
     */
    private LocalTime parseWindowTimeParam(String value) {
        if (value == null) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        try {
            return WindowFocusAggregator.parseRequestTime(value);
        } catch (DateTimeParseException e) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
    }

    /**
     * TIME_WINDOW 파라미터 검증(§A6 · GROMO-1406/1422). 누락·형식 오류는
     * {@link #parseWindowTimeParam} 이 먼저 거른다.
     *
     * <ul>
     *   <li>A6-1: <b>시작 &lt; 종료</b> 단일 조건 — 자정 걸침 금지(22:00~01:00 거부, 22:00~23:59 허용).
     *       걸친 창은 회차가 요일 경계를 넘어 판정일·겹침·정산 귀속이 전부 모호해진다(N25)</li>
     *   <li>A6-2: 목표분 0 &lt; x ≤ 창 길이</li>
     *   <li>A6-3: SCREEN_TIME 목표는 15분 배수 — 측정 눈금보다 고운 목표는 판정 불가
     *       ({@code CHALLENGE_GOAL_NOT_ALIGNED})</li>
     *   <li>A6-4(N31): FOCUS 목표는 관용치(5분)보다 커야 한다 — 판정이 분 ≥ 목표−5 라 1~5분이면
     *       0분도 자동 달성이 된다</li>
     * </ul>
     */
    private void validateTimeWindowParams(MissionCategory category,
            LocalTime start, LocalTime end, Integer goal) {
        if (!start.isBefore(end)) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (goal == null || goal <= 0 || goal > windowLengthMinutes(start, end)) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (category == MissionCategory.FOCUS
                && goal <= WindowFocusAggregator.WINDOW_FOCUS_TOLERANCE_MINUTES) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (category == MissionCategory.SCREEN_TIME && goal % SCREEN_TIME_GOAL_STEP_MINUTES != 0) {
            throw new GroupException(GroupErrorCode.CHALLENGE_GOAL_NOT_ALIGNED);
        }
    }

    /**
     * 활성 창형과 KST 시각대가 겹치면 거부 — 같은 시간대 행동 하나로 내기 2개 중복 보상을 막는다(§A5).
     * 창형 복수 허용(FR-3 · GROMO-1422)에 맞춰 <b>카테고리 무관 전건</b>과 비교한다(종전의 같은 카테고리
     * 건너뛰기는 카테고리×타입당 1개 시절의 전제였다).
     *
     * <p>기존 창 행을 FOR UPDATE 로 잠가 동시 생성·삭제와 직렬화한다(챌린지 행 락 관행 재사용).
     * 맞닿음(끝==시작)은 겹침이 아니다(종전 겹침 검사와 동일).
     *
     * <p>한계(후속 GROMO-1270): 요일 교집합(요일이 안 겹치면 시간대가 같아도 무방)과 15분 간격 규칙은
     * 아직 반영 전이다 — 그때까지는 요일 무관하게 시간대만으로 겹침을 판정한다(엄격한 쪽으로 보수적).
     */
    private void rejectWindowOverlap(Group group, LocalTime start, LocalTime end) {
        for (GroupChallengeWindow existing : groupChallengeWindowRepository.findActiveByGroupForUpdate(group)) {
            if (windowsOverlap(start, end, existing.getWindowStart(), existing.getWindowEnd())) {
                throw new GroupException(GroupErrorCode.CHALLENGE_WINDOW_OVERLAP);
            }
        }
    }

    /**
     * 창 [s, e) 두 개의 겹침 — 자정 걸침이 금지(§A6-1)라 <b>단일 구간 비교</b>로 충분하다
     * (종전의 2구간 전개(daySegments)는 걸침 허용 시절의 잔재였다 — GROMO-1406 되돌리기).
     */
    private static boolean windowsOverlap(LocalTime aStart, LocalTime aEnd,
            LocalTime bStart, LocalTime bEnd) {
        return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
    }

    /** 창 길이(분) — 시작 < 종료 불변식(§A6-1) 아래라 단순 차다. */
    private static int windowLengthMinutes(LocalTime start, LocalTime end) {
        return (end.toSecondOfDay() - start.toSecondOfDay()) / 60;
    }

    @Transactional
    public void deleteChallenge(UUID groupId, UUID challengeId, UUID userId) {
        User user = requireActiveUser(userId);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        if (groupMember.getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        // 이미 삭제된 챌린지는 조회 단계에서 걸러져 NOT_FOUND — 중복 DELETE 가 404 로 떨어진다.
        // 행을 잠그고 읽는 이유는 아래 회차 무효화를 참여·개설(같은 챌린지 행 락)과 직렬화하기
        // 위해서다 — 락이 없으면 무효화 스캔과 softDelete 사이에 새 참가가 끼어들어 삭제된
        // 챌린지에 참가비가 걸린 회차가 매달린다(종전 삭제 락 유지 — N42 계열).
        GroupChallenge groupChallenge = groupChallengeRepository
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // to-be(FR-12, GROMO-1272): 삭제는 언제든 가능하다 — 종전 "OPEN 있으면 삭제 차단"
        // (CHALLENGE_HAS_OPEN_BET)을 대체한다. OPEN 회차(예약된 미래 포함)는 전부
        // VOIDED(CHALLENGE_DELETED) 로 무효화하고 참가비를 전원 환불한다(0명 회차는 UNUSED —
        // N52). 정산 완료 회차는 불변이다(FR-13). 같은 트랜잭션이라 삭제와 환불이 원자다.
        groupBetSettler.voidOpenSessionsForChallengeDelete(challengeId);

        groupChallenge.softDelete();
    }

    /**
     * 챌린지 종료(§A8 · FR-11 · GROMO-1261) — 깨끗한 마감: 더 이상 새 회차를 세우지 않는다.
     * 그룹장 전용, 이미 ENDED 면 멱등(204). 삭제와 달리 환불 의무가 없으므로 <b>진행 중(OPEN 회차
     * 존재)이면 불가</b>다 — 이를 허용하면 그룹장이 남의 돈이 걸린 불리한 회차를 대가 없이 무를 수 있다.
     *
     * <p>N42: 종료도 삭제와 같은 <b>챌린지 행 배타 락</b>으로 참여 경로와 직렬화한다. 락 없이 돌면
     * 참여 트랜잭션의 미커밋 회차를 못 보고 "OPEN 없음"으로 ENDED 를 확정한 뒤 참가가 커밋돼,
     * 종료된 챌린지에 참가비가 걸린다(무효화도 환불도 안 된 고아 회차 — 삭제보다 결과가 나쁘다).
     */
    @Transactional
    public void endChallenge(UUID groupId, UUID challengeId, UUID userId) {
        User user = requireActiveUser(userId);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        if (groupMember.getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        GroupChallenge groupChallenge = groupChallengeRepository
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 멱등 — 이미 종료된 챌린지의 재종료 요청은 무해하다(ended_at 도 당겨쓰지 않는다).
        if (groupChallenge.getStatus() == GroupChallengeStatus.ENDED) {
            return;
        }

        // FR-11: OPEN 회차가 하나라도 있으면 종료 불가 — 결정적 409.
        // 원래는 bets.status 를 봤지만(GROMO-1406 작성 시점의 스키마) 2계층 재편(GROMO-1262)으로
        // status 축이 회차로 옮겨가며 `existsByChallengeIdAndStatus` 가 폐기됐다. 같은 뜻을 회차
        // 축에서 묻는 기존 쿼리를 재사용한다 — 새 리포지토리 주입 없이 단건으로 부른다.
        if (!groupChallengeBetRepository.findChallengeIdsWithOpenBet(List.of(challengeId)).isEmpty()) {
            throw new GroupException(GroupErrorCode.CHALLENGE_END_BLOCKED);
        }

        groupChallenge.end();
        log.info("챌린지 종료 — challengeId={}, groupId={}, userId={}", challengeId, groupId, userId);
    }

    /**
     * 스크린타임 창 사용분 보고 — (챌린지, 유저, 날짜)당 1행 upsert. 중간 보고를 허용하고 마지막 값이
     * 이긴다(창 종료 전 부분 집계 → 종료 후 최종 보고로 덮어쓰기).
     *
     * <p>값은 <b>클라 신뢰</b>다 — 서버가 검증할 수단이 없어 범위(0~{@value #MAX_WINDOW_USAGE_MINUTES})만
     * 확인하고 그대로 저장한다(리스크 수용, 확정 정책). measuredAt 은 저장하지 않고 로그로만 남긴다.
     */
    @Transactional
    public void reportWindowUsage(UUID groupId, UUID challengeId, UUID userId, WindowUsageReportRequest request) {
        User user = requireActiveUser(userId);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        GroupChallenge challenge = groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        if (challenge.getCategory() != MissionCategory.SCREEN_TIME
                || challenge.getType() != MissionType.TIME_WINDOW) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (request.getUsedMinutes() < 0 || request.getUsedMinutes() > MAX_WINDOW_USAGE_MINUTES) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }

        groupChallengeMemberRepository.upsertWindowUsage(
                Generators.timeBasedEpochRandomGenerator().generate(),
                challengeId, userId, request.getDate(), request.getUsedMinutes());
        log.info("창 사용분 보고 — challengeId={}, userId={}, date={}, usedMinutes={}, measuredAt={}",
                challengeId, userId, request.getDate(), request.getUsedMinutes(), request.getMeasuredAt());
    }

    // TIME_WINDOW 상세의 time 값을 "HH:mm:ss" 문자열로 변환 — 그룹 상세·오버뷰(GroupService,
    // GROMO-1206)와 같은 단일 출구(WindowFocusAggregator.timeOfDayString)를 쓴다.
    private String toLocalTimeString(LocalTime time) {
        return WindowFocusAggregator.timeOfDayString(time);
    }

    /**
     * 활성 검증 + 공유 락 + 게스트 차단 (GROMO-801 락 규율, GROMO-1237) — 챌린지 생성·삭제·창 사용분
     * 보고처럼 users 행은 <b>읽기만 하고</b> 그룹 상태를 변경하는 트랜잭션의 요청자 로드. 락 없는
     * findById 는 계정 탈퇴(UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아 탈퇴한 방장의
     * 그룹 상태 변경(createGroup #516 과 같은 계열)이나 (challenge, user, date) upsert 유령 행이
     * 남을 수 있다. 공유 락끼리는 충돌하지 않아 동시 요청은 그대로 병렬이고, 탈퇴가 먼저 커밋되면
     * READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404). 게스트는 기존 가드 그대로
     * GUEST_FORBIDDEN(403).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        User user = userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }
}
