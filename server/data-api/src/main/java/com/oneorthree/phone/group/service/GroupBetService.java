package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.domain.RepeatSchedule;
import com.oneorthree.phone.group.dto.ChallengeMemberProgressResponse;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetConfigResponse;
import com.oneorthree.phone.group.dto.GroupBetHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.dto.GroupBetParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupBetResultParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResultResponse;
import com.oneorthree.phone.group.dto.GroupBetSessionParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetSessionResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.group.support.GroupBetSessionFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 그룹 챌린지 내기 — 설정({@link GroupChallengeBet})·회차({@link GroupChallengeBetSession}) 2계층
 * (GROMO-1262) 위의 유저 요청 경로(참여·취소·조회 조립)와 구 API 브리지(N36).
 *
 * <p><b>구 API 브리지</b>: 구 앱의 "개설/참가/취소/철회" 경로와 응답 레거시 필드(betId·status·
 * myJoined·participants)는 그대로 유지한다 — 경로의 {@code betId} 는 이제 <b>회차 id</b> 로
 * 해석된다(개설 응답이 회차 id 를 돌려주므로 구 앱 흐름이 그대로 돈다). 신 참여 API(join·join-next·
 * join-week)는 {@link GroupBetJoinService}(GROMO-1408) 가 이 클래스의 참가 커널(newSession·stakeIn·
 * 자격 가드)을 재사용해 구현한다 — 돈이 움직이는 경로가 갈라지지 않게 패키지 전용으로 연다.
 *
 * <p><b>돈 흐름 멱등키는 참가 행 id 가 단일 축</b>이다(FR-42): 차감 {@code session:{sid}:stake:{pid}} ·
 * 환불 {@code session:{sid}:refund:{pid}}(취소·탈퇴·무산·24h 전 경로 공용) · 지급
 * {@code session:{sid}:payout:{pid}}({@link GroupBetSettler#payoutKey}). 환불 키를 경로별로 나누지
 * 않으므로 취소 × 탈퇴가 겹쳐도 원장 UNIQUE 가 교차 경로 이중 환불을 막는다(1258 P0 ①).
 *
 * <p><b>잠금 규율</b>: {@code user(공유) → 멤버십 → 회차(id 오름차순, 전부) → 지갑(userId 오름차순)}.
 * 참여는 멤버십 행 공유 잠금으로 그룹 탈퇴와 직렬화하고(N54 — 1258 P0 ②), 회차를 잠근 뒤에는
 * 참가 행을 <b>재조회</b>한다(1258 P0 ③ — 잠금 대기 중 다른 경로가 이미 처리했을 수 있다).
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupBetService {

    /**
     * 참가비 허용 범위 — 정수 1~3000 (N30, GROMO-1264). 프리셋(300/900/1,500/3,000)은 앱의 빠른
     * 선택 칩일 뿐이고 서버는 범위만 본다. DB 도 V40 CHECK 로 같은 범위를 강제한다(설정·회차 양쪽).
     */
    static final int MIN_STAKE = 1;
    static final int MAX_STAKE = 3000;

    /** 내기 히스토리 페이지 크기 상한 — 집중 세션 슬라이스({@code FocusService})와 같은 값. */
    static final int MAX_HISTORY_PAGE_SIZE = 100;

    /**
     * 히스토리에 실리는 status — 구앱이 아는 정산 결과 3종. UNUSED(0명 종료)는 결과가 아니라 어디에도
     * 싣지 않고(N52), VOIDED 는 신 API(B8)부터 노출한다(구앱은 렌더 분기가 없다).
     */
    private static final List<GroupBetStatus> HISTORY_STATUSES =
            List.of(GroupBetStatus.SETTLED, GroupBetStatus.REFUNDED, GroupBetStatus.FORFEITED);

    /**
     * 탈퇴 유저 표시 문구 (GROMO-1220, 결정 D1) — 탈퇴는 소프트딜리트라 nickname 이 파기(null)되는데,
     * 정산 명단·히스토리는 참가 행이 이력으로 영구 보존되어 빈 닉네임이 그대로 노출된다. 명단에서
     * <b>제거하지 않고 치환만</b> 하는 이유: pot = stake × 원본 participants.size() 라(계약 §1)
     * 행을 빼면 인원·금액이 실제 정산과 어긋난다.
     */
    static final String WITHDRAWN_USER_NICKNAME = "탈퇴한 사용자";

    /**
     * 시작 후 참가(하루형)의 취소 유예(N22, GROMO-1423) — 하루형은 회차 시작이 자정이라 "시작 전"이
     * 영영 오지 않으므로, 오탭 구제로 참가 후 5분만 무를 수 있다. 시작 전 참가(창형·예약분)에는
     * 유예가 없다 — 주면 창 시작 직전 참가자가 시작 후에 취소할 수 있어 "시작 후 환불 없음"이 깨진다.
     * {@link #leaveDeadline} 가 단일 판정점이고, 카드 응답의 {@code bet.session.myLeaveDeadlineAt}
     * (GROMO-1418)도 같은 함수를 싣는다.
     */
    static final Duration LEAVE_GRACE = Duration.ofMinutes(5);

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupMemberRepository groupMemberRepository;
    private final GroupQueryService groupQueryService;
    private final UserQueryService userQueryService;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;
    private final GroupBetSessionFactory groupBetSessionFactory;
    private final GroupBetWindowUsageService groupBetWindowUsageService;

    // ── 개설 브리지 / 참가 ──────────────────────────────────────────────

    /**
     * 레거시 개설 경로(N36 브리지) — 2계층에서 "개설"은 <b>설정 보장 + 그 날짜 회차 개설 + 본인
     * 참가</b>로 해석된다. 설정이 없으면 만들고(챌린지 1:1), 이미 있으면 요청 stake 로 갱신한다
     * (회차가 자기 stake 를 박제하므로 과거 회차·정산은 불변). 응답의 {@code betId} 는 <b>회차 id</b> 다
     * — 구앱이 그 값으로 참가·취소를 호출하는 흐름이 그대로 성립한다.
      *
      * @param groupId 챌린지 스코프
      * @param challengeId 내기를 걸 챌린지 — 설정이 없으면 만들고, 있으면 요청 참가비로 갱신한다
      * @param userId 요청자 — 개설과 동시에 본인이 참가 처리돼 참가비가 즉시 빠진다
      * @param request 참가비와 회차 날짜. 날짜는 KST 오늘·내일만 허용하고 그 밖은 {@code BET_CLOSED} 다
      * @return 구앱이 참가·취소에 그대로 쓰는 {@code betId} — 실제로는 <b>회차 id</b> 다
     */
    @Transactional
    public CreateBetResponse createBet(UUID groupId, UUID challengeId, UUID userId, CreateBetRequest request) {
        User user = requireActiveUser(userId);
        Group group = requireGroupMembershipForShare(user, groupId);

        int stake = request.getStake();
        if (stake < MIN_STAKE || stake > MAX_STAKE) {
            throw new GroupException(GroupErrorCode.BET_INVALID_STAKE);
        }
        // 회차는 "오늘 또는 내일"(KST)에만 열 수 있다(계약 §3, GROMO-1103) — 지난 날짜는 결과가
        // 이미 정해졌고, 모레 이후는 앱이 만들 수 없는 값이다(주간 예약은 B4 join-week 의 몫).
        LocalDate sessionDate = request.getDate();
        LocalDate today = today();
        if (!sessionDate.equals(today) && !sessionDate.equals(today.plusDays(1))) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }

        // 챌린지 행을 잠그고 읽는다 — 삭제(deleteChallenge)·동시 개설과 직렬화하기 위해서다. 락이
        // 없으면 "OPEN 회차가 없다"고 본 삭제와 이 개설이 겹쳐, 참가비가 걸린 회차가 삭제된 챌린지에
        // 매달린다.
        GroupChallenge challenge = groupChallengeRepository
                .findByIdAndGroupAndDeletedAtIsNullForUpdate(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.CHALLENGE_NOT_FOUND));
        if (challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
            throw new GroupException(GroupErrorCode.BET_CHALLENGE_INACTIVE);
        }
        // 활성 요일 검증(N35 — 개설 4경로 공통 조건, PR #567 리뷰 이관): 비활성 요일에는 회차가
        // 설 수 없다. 마감(BET_CLOSED)과 같은 코드로 거절한다 — 구앱은 요일을 몰라 별도 분기가
        // 없고, "이 날짜에는 참가가 닫혀 있다"는 의미가 같다.
        //
        // 판정은 카드의 activeToday 와 같은 함수·같은 원값이다(repeatDaysOf → RepeatSchedule)
        // — 갈리면 카드가 "오늘은 쉬는 날"이라 표시한 챌린지에서 참가비가 차감된다.
        if (!RepeatSchedule.activeOn(repeatDaysOf(challenge), sessionDate)) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
        // 게이트 = DURATION || (TIME_WINDOW && 창 목표분 있음). 카테고리 제한은 없다.
        GroupBetJudge.Target target = groupBetJudge.resolve(challenge)
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
        // 창 마감 검사는 오늘 회차에만 건다 — 내일 창은 아직 시작도 안 했으니 항상 열려 있다.
        if (sessionDate.equals(today)) {
            requireWindowStillOpen(target, sessionDate);
        }

        GroupChallengeBet bet = ensureBetConfig(group, challenge, stake);
        // UNIQUE (bet_id, session_date) 의 사전 검사 — 같은 날짜 회차가 이미 있으면(진행 중이든
        // 정산됐든) 구 계약 그대로 409 다. "취소 후 재개설"은 회차 삭제("없던 일")로 표현되므로
        // 재개설 시점엔 행이 없다.
        if (groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(bet.getId(), sessionDate).isPresent()) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
        requireEligibleToStake(target, user, sessionDate);

        GroupChallengeBetSession session;
        try {
            // saveAndFlush — INSERT 를 지금 내보내야 유니크 위반이 이 try 안에서 잡힌다.
            session = groupChallengeBetSessionRepository.saveAndFlush(
                    groupBetSessionFactory.create(bet, group, challenge, target, sessionDate));
        } catch (DataIntegrityViolationException e) {
            // 사전 검사와 동시 개설이 겹친 레이스 — 유니크(설정·날짜당 회차 1개) 위반을 결정적인
            // 409 로 강하한다. 이 시점엔 참가비가 아직 걷히지 않았다(stakeIn 전).
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
        stakeIn(session, user);

        log.info("내기 회차 개설 — sessionId={}, betId={}, challengeId={}, sessionDate={}, stake={}, opener={}",
                session.getId(), bet.getId(), challengeId, sessionDate, session.getStake(), userId);
        return CreateBetResponse.builder().betId(session.getId()).build();
    }

    /**
     * 진행 중(OPEN·오늘 또는 내일) 회차에 참가한다. 참가비는 즉시 차감된다.
     *
     * @param groupId 회차 스코프 — 다른 그룹의 회차 id 는 여기서 {@code BET_NOT_FOUND} 로 걸린다
     * @param sessionId 구 API 경로의 {@code betId} — 브리지에서 회차 id 로 해석된다
     * @param userId 요청자 — 이미 목표를 달성했으면 무위험 참가로 보고 거절한다
     */
    @Transactional
    public void joinBet(UUID groupId, UUID sessionId, UUID userId) {
        User user = requireActiveUser(userId);
        requireGroupMembershipForShare(user, groupId);

        // 행 잠금 — "OPEN 확인 → 참가 행 삽입 + 차감"이 check-then-act 라, 잠금 없이는 그 사이에
        // 철회·정산이 끼어들어 방금 종료된 회차에 참가비가 묶인다.
        GroupChallengeBetSession session = groupChallengeBetSessionRepository
                .findByIdAndGroupIdForUpdate(sessionId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        // 정산됐거나(status≠OPEN) 날짜가 지난 회차는 닫힌 것으로 본다. 배치가 돌기 전(FOCUS 01:00 /
        // SCREEN_TIME 12:00 KST 이전)의 전일자 회차가 여기 걸린다. 미래(내일) 회차는 참가를 허용한다.
        if (!session.isOpen() || session.getSessionDate().isBefore(today())) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
        if (groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(sessionId, userId)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_JOINED);
        }
        GroupBetJudge.Target target = targetOf(session);
        requireWindowStillOpen(target, session.getSessionDate());
        requireEligibleToStake(target, user, session.getSessionDate());

        stakeIn(session, user);
        log.info("내기 회차 참가 — sessionId={}, userId={}, stake={}", sessionId, userId, session.getStake());
    }

    // ── 취소 / 철회 / 그룹·계정 탈퇴 연동 ─────────────────────────────────

    /**
     * 레거시 취소 브리지 — 참가자가 <b>본인 1명뿐</b>인 OPEN 회차를 "없던 일"로 만든다: 참가를 무르고
     * 환불한 뒤 회차 행을 삭제한다(재편으로 CANCELED 상태는 소멸 — 빈 유저 개설 회차를 남기면 구앱
     * 카드에 0명 판이 서고 같은 날짜 재개설이 막힌다). 타인이 참가한 회차는 무를 수 없다
     * ("질 것 같으면 무르기" 방지 — 구 계약의 {@code BET_CANCEL_HAS_OTHERS} 그대로).
     *
     * <p>개설자 개념이 사라졌으므로 "개설자 본인" 검사는 "내가 참가자인가"로 해석된다 — 단독 참가
     * 회차에서 그 참가자가 곧 개설자였던 구 의미와 실질이 같다.
      *
      * @param groupId 회차 스코프
      * @param sessionId 없던 일로 만들 회차 — 참가자가 본인 1명뿐이어야 한다
      * @param userId 요청자 — 이 회차 참가자가 아니면 {@code BET_CANCEL_FORBIDDEN}
     */
    @Transactional
    public void cancelBet(UUID groupId, UUID sessionId, UUID userId) {
        User user = requireActiveUser(userId);
        requireGroupMembership(user, groupId);

        GroupChallengeBetSession session = groupChallengeBetSessionRepository
                .findByIdAndGroupIdForUpdate(sessionId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        // 잠금 후 참가자 재조회(P0 ③) — 검증 순서는 구 계약(참가자 여부 → 타인 존재 → OPEN) 그대로.
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(sessionId));
        GroupChallengeBetParticipant mine = participants.stream()
                .filter(p -> p.getUser().getId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_CANCEL_FORBIDDEN));
        if (participants.size() > 1) {
            throw new GroupException(GroupErrorCode.BET_CANCEL_HAS_OTHERS);
        }
        if (!session.isOpen()) {
            throw new GroupException(GroupErrorCode.BET_NOT_OPEN);
        }
        // 취소 마감(N22, GROMO-1423) — 이 브리지에도 신 경로와 같은 단일 판정점을 건다. 신 참여
        // (join·join-next·join-week)가 만든 회차 id 를 이 경로에 넣으면 참가자 수·OPEN 만 보고 전액
        // 환불되던 구멍(codex P1 ②): 하루형 5분 유예·창형/예약분의 회차 시작 마감이 전부 우회됐다.
        // 구앱의 "개설 직후 취소"는 참가+5분 유예 안이라 그대로 성립한다.
        if (!Instant.now().isBefore(leaveDeadline(session, mine))) {
            throw new GroupException(GroupErrorCode.BET_LEAVE_CLOSED);
        }

        groupChallengeBetParticipantRepository.delete(mine);
        refundStake(session, user, mine.getId());
        groupChallengeBetSessionRepository.delete(session);
        log.info("내기 회차 취소 — sessionId={}, challengeId={}, userId={}, stake={} 환불, 회차 삭제",
                sessionId, session.getChallenge().getId(), userId, session.getStake());
    }

    /**
     * 참가 철회(GROMO-1102 → 취소 마감 분기 GROMO-1423·N22) — <b>취소 마감 전</b>인 OPEN 회차에서
     * 호출자 본인의 참가만 무르고 본인 참가비를 환불한다. 남은 참가자가 있으면 회차는 유지되고,
     * 마지막 참가자가 떠나면 회차를 "없던 일"로 삭제한다(구 CANCELED 의 재편 후 표현 —
     * {@link #cancelBet} 과 같은 규칙).
     *
     * <p>취소 마감은 {@link #leaveDeadline} 하나로 판정한다: 시작 전 참가 → 회차 시작까지(유예 없음),
     * 시작 후 참가(하루형) → min(참가+5분, 회차 종료). 예약분(join-next·join-week)도 같은 규칙이다
     * — 미래 회차 참가는 항상 "시작 전 참가"라 회차 시작까지 무를 수 있다.
     *
     * <p>카드 응답의 {@code bet.session.myLeaveDeadlineAt}(GROMO-1418)이 <b>같은 함수</b>를 싣는다.
     * 종전처럼 {@code startsAt} 만 보면 하루형 당일 참가자는 화면이 알려준 유예(참가+5분) 안에
     * 눌러도 무조건 {@code BET_LEAVE_CLOSED} 라, 응답이 거짓말을 하고 환불이 막힌다.
      *
      * @param groupId 회차 스코프
      * @param sessionId 참가를 물릴 회차 — 남은 참가자가 있으면 회차는 그대로 살아 있다
      * @param userId 요청자 — 본인 참가 한 건만 대상이고, 마감이 지났으면 {@code BET_LEAVE_CLOSED}
     */
    @Transactional
    public void leaveBet(UUID groupId, UUID sessionId, UUID userId) {
        User user = requireActiveUser(userId);
        requireGroupMembership(user, groupId);

        GroupChallengeBetSession session = groupChallengeBetSessionRepository
                .findByIdAndGroupIdForUpdate(sessionId, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        // 검증 순서 계약(§4): 참가자 여부 → OPEN → 시작 전. 참가자 읽기는 잠금 뒤다(P0 ③).
        List<GroupChallengeBetParticipant> participants =
                groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(sessionId));
        GroupChallengeBetParticipant mine = participants.stream()
                .filter(p -> p.getUser().getId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_JOINED));
        if (!session.isOpen()) {
            throw new GroupException(GroupErrorCode.BET_NOT_OPEN);
        }
        if (!Instant.now().isBefore(leaveDeadline(session, mine))) {
            throw new GroupException(GroupErrorCode.BET_LEAVE_CLOSED);
        }

        groupChallengeBetParticipantRepository.delete(mine);
        refundStake(session, user, mine.getId());
        boolean lastParticipant = participants.size() == 1;
        if (lastParticipant) {
            groupChallengeBetSessionRepository.delete(session);
        }
        log.info("내기 참가 철회 — sessionId={}, userId={}, stake={} 환불, 회차삭제={}",
                sessionId, userId, session.getStake(), lastParticipant);
    }

    /**
     * 그룹 탈퇴 연동 — 탈퇴자가 참가 중인 이 그룹의 OPEN 회차에서 빼고 참가비를 환불한다.
     * {@link GroupMemberService#withdrawGroup} 가 탈퇴와 <b>같은 트랜잭션</b>에서 호출한다.
     *
     * <p><b>멤버십 행 배타 잠금으로 시작한다</b>(N54 의 반대편) — withdrawGroup 은 회차 정리 후에야
     * {@code leave()} 를 마킹하므로, 이 선점이 없으면 "정리 스캔 → leave" 사이에 참여 경로의 새
     * 참가가 끼어들어 그룹에 없는 사람의 유료 참가가 남는다(1258 P0 ②). 참여 경로의 멤버십 공유
     * 잠금({@link #requireGroupMembershipForShare})과 이 배타 잠금이 멤버십 행에서 직렬화된다.
     *
     * <p><b>불변식: 그룹 상태(ENDED 등)를 보지 않는다</b> — 회차 status 만이 게이트다.
      *
      * @param user 그룹을 나가는 유저 — 참가 행을 지우고 참가비를 되돌려준다
      * @param group 정리 범위. 이 그룹의 OPEN 회차만 건드리고 다른 그룹의 참가는 그대로 둔다
     */
    @Transactional
    public void releaseFromOpenBets(User user, Group group) {
        groupMemberRepository.findActiveByUserIdAndGroupIdForUpdate(user.getId(), group.getId());
        releaseSessions(groupChallengeBetSessionRepository
                .findOpenSessionIdsByGroupIdAndParticipantUserId(group.getId(), user.getId()), user);
    }

    /**
     * 계정 탈퇴 연동(GROMO-801) — 탈퇴자가 참가 중인 <b>모든 그룹</b>의 OPEN 회차를 한 번에
     * 정리한다. {@code UserService.withdraw} 가 유저 행 배타 락 아래, 탈퇴와 같은 트랜잭션에서
     * 호출한다(참여 경로의 유저 공유 락과 직렬화 — 멤버십 잠금이 따로 필요 없다).
     *
     * <p>강퇴자는 활성 멤버십이 없어도 OPEN 회차의 참가자다 — 그래서 <b>참가 행 스코프</b>로 걷는다.
      *
      * @param user 계정을 지우는 유저 — 활성 멤버십이 없어도(강퇴자) 참가 행이 있으면 정리 대상이다
     */
    @Transactional
    public void releaseFromAllOpenBets(User user) {
        releaseSessions(groupChallengeBetSessionRepository
                .findOpenSessionIdsByParticipantUserId(user.getId()), user);
    }

    /**
     * 계정 탈퇴 직전 판정 근거 박제(GROMO-1423, codex P1 ③) — 탈퇴 정리
     * ({@link #releaseFromAllOpenBets})가 환불하지 못하고 <b>정산 대상으로 남기는</b> OPEN 참가
     * 행마다, 통계 nullify 전 시점의 달성 여부·진행분을 참가 행에 박제한다.
     * {@code UserService.withdraw} 가 회차 정리 <b>후</b>·통계 nullify <b>전</b>에 부른다.
     *
     * <p>이게 없으면 nullify 가 focus/daily 통계를 지워 FOCUS·하루형 SCREEN_TIME 판정이 0분/미보고로
     * 왜곡된다 — 실제 달성자가 미달성으로 떨어져 <b>남은 참가자들의 지급액까지 틀어진다</b>. 박제 축은
     * 조기 확정({@code GroupChallengeBetParticipant#confirmWin}, GROMO-1268)과 동일하다 — 달성 시점에
     * {@code achieved=true} + 실측 분. 미달성 참가자는 박제하지 않는다: 관측이 끝났으므로 정산의
     * 미보고=미달성 확정과 결론이 같고, {@code achieved} 는 null 로 남아 "판정 안 됨" 의미가 유지된다.
     *
     * <p>창형 SCREEN_TIME 의 클라 보고분({@code group_challenge_members})은 탈퇴가 지우지 않으므로
     * 박제 없이도 정산이 그대로 읽는다 — 그래도 같은 규칙으로 박제해 두면 판정 소스가 하나로 줄 뿐
     * 결론은 같다(멱등·무해).
      *
      * @param user 계정을 지우는 유저 — 이 유저의 <b>달성</b> 참가 행만 박제한다. 미달성은 손대지 않아
      *     {@code achieved} 가 null(판정 안 됨)로 남고, 정산의 미보고=미달성 확정과 결론이 같다
     */
    @Transactional
    public void freezeEvidenceForAccountErasure(User user) {
        List<UUID> sessionIds =
                groupChallengeBetSessionRepository.findOpenSessionIdsByParticipantUserId(user.getId());
        for (UUID sessionId : sessionIds) {   // id 오름차순 — 잠금 순서 규약(계약 §3)
            Optional<GroupChallengeBetSession> locked = groupQueryService.findBetSessionForUpdate(sessionId)
                    .filter(GroupChallengeBetSession::isOpen);
            if (locked.isEmpty()) {
                continue;   // 잠금 대기 중 정산됨 — 결과를 존중한다.
            }
            GroupChallengeBetSession session = locked.get();
            Optional<GroupChallengeBetParticipant> mine = groupChallengeBetParticipantRepository
                    .findBySessionIdAndUserId(sessionId, user.getId());
            // 재조회(P0 ③) 후: 행이 없으면 이미 정리됐고, achieved 가 있으면 조기 확정(GROMO-1268)이
            // 먼저 박제했다 — 둘 다 할 일이 없다.
            if (mine.isEmpty() || mine.get().getAchieved() != null) {
                continue;
            }
            // CTI 유실 등으로 판정 불가면 건너뛴다(조기 확정과 같은 태도) — 정산도 같은 이유로
            // 실패·백오프를 타므로 여기서 탈퇴를 막을 이유가 없다.
            Optional<GroupBetJudge.Target> target = groupBetJudge.ofSession(session);
            if (target.isEmpty()) {
                continue;
            }
            Integer minutes = groupBetJudge
                    .progressMinutes(target.get(), session.getSessionDate(), List.of(user))
                    .get(user.getId());
            if (GroupBetJudge.isAchieved(target.get(), minutes)) {
                // 확정 시각도 함께 박제한다(V42 achieved_at) — 탈퇴 박제도 "승리가 닫힌 순간"이
                // 있는 사건이라 조기 확정과 같은 축을 남긴다.
                mine.get().confirmWin(minutes == null ? 0 : minutes, Instant.now());
                log.info("탈퇴 판정 근거 박제 — sessionId={}, userId={}, progressMinutes={}",
                        sessionId, user.getId(), minutes);
            }
            // 여기서 끝이다 — 이 메서드는 <b>판정 근거만 남긴다</b>. 참가 행 삭제·환불·빈 회차 정리는
            // 전부 releaseFromAllOpenBets(→ releaseSessions)의 "취소 마감 전" 분기 소유다. 두 책임이
            // 섞이면 마감이 지나 정산 대상으로 남긴 참가를 이 루프가 도로 환불해, 계정 탈퇴가 취소
            // 마감을 우회하는 환불 경로가 된다(FR-40 위반 — 실제로 병합 충돌 해소 중 되살아났던 회귀).
        }
    }

    /**
     * 탈퇴자가 참가한 OPEN 회차 행을 id 오름차순으로 전부 잠근다 — 돈도 상태도 건드리지 않는다 (GROMO-893).
     *
     * <p>호출부(계정 탈퇴)가 USER aggregate 를 쓰기 전에 부른다. 이후 {@link #releaseFromAllOpenBets} 가 같은
     * 순서로 다시 잠글 때는 이미 쥔 행이라 기다리지 않는다.
     *
     * @param user 탈퇴 중인 유저
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockOpenSessionsForAccountWithdrawal(User user) {
        for (UUID sessionId : groupChallengeBetSessionRepository.findOpenSessionIdsByParticipantUserId(user.getId())) {
            groupQueryService.findBetSessionForUpdate(sessionId);
        }
    }

    private void releaseSessions(List<UUID> sessionIds, User user) {
        // 1단계: 대상 회차 행을 id 오름차순으로 전부 잠근다 — 지갑 쓰기 없이 잠금만(계약 §3 잠금
        // 순서: 회차 전부 → 지갑). 잠금 시점에 이미 종료된 회차는 정산 결과를 존중해 제외한다.
        List<GroupChallengeBetSession> lockedOpenSessions = new ArrayList<>();
        for (UUID sessionId : sessionIds) {
            groupQueryService.findBetSessionForUpdate(sessionId)
                    .filter(GroupChallengeBetSession::isOpen)
                    .ifPresent(lockedOpenSessions::add);
        }

        // 2단계: 잠금이 전부 확보된 뒤에만 돈을 움직인다. 참가 행은 잠금 <b>이후</b> 재조회한다
        // (P0 ③) — 대상 조회와 잠금 사이에 본인 철회·취소가 먼저 처리했으면 행이 없고, 그러면
        // 아무것도 하지 않는다(이중 환불 원천 차단 — 키가 같아 원장 유니크가 최후 방어).
        for (GroupChallengeBetSession session : lockedOpenSessions) {
            Optional<GroupChallengeBetParticipant> mine = groupChallengeBetParticipantRepository
                    .findBySessionIdAndUserId(session.getId(), user.getId());
            if (mine.isEmpty()) {
                continue;
            }
            // 취소 마감이 지난 회차는 환불하지 않고 정산 대상으로 남긴다(FR-40 — 취소와 같은 규칙,
            // GROMO-1423). 탈퇴로 시작된 판의 돈을 되찾는 각도를 막는 것이고, 명단에는 정산 시
            // "탈퇴한 사용자"로 표기된다(D1). 참가 후 5분 안의 하루형 오탭은 탈퇴 경로에서도 무른다.
            if (!Instant.now().isBefore(leaveDeadline(session, mine.get()))) {
                log.info("내기 참가 유지 — 탈퇴 연동, 취소 마감 경과로 정산 잔류. sessionId={}, userId={}",
                        session.getId(), user.getId());
                continue;
            }
            groupChallengeBetParticipantRepository.delete(mine.get());
            refundStake(session, user, mine.get().getId());
            long remaining = groupChallengeBetParticipantRepository.countBySessionId(session.getId());
            if (remaining == 0) {
                // 유저 개설 회차가 비면 "없던 일" — 구 자동 취소(CANCELED)의 재편 후 표현이다.
                groupChallengeBetSessionRepository.delete(session);
            }
            log.info("내기 참가 해제 — 탈퇴 연동. sessionId={}, userId={}, stake={} 환불, 잔여 {}명",
                    session.getId(), user.getId(), session.getStake(), remaining);
        }
    }

    /**
     * 취소 마감(N22 최종안, GROMO-1423) — 참가 시점 기준 분기의 <b>단일 판정점</b>(철회·그룹 탈퇴 공용).
     *
     * <ul>
     *   <li><b>시작 전에 참가</b>(창형·예약분) → 회차 시작까지. 유예 없음 — max(시작, 참가+5분)으로
     *       쓰면 창 시작 직전 참가자가 시작 후 5분까지 취소할 수 있어 "시작 후 환불 없음"이 깨진다
     *       (창 초반을 보고 발을 빼는 각도가 생긴다).</li>
     *   <li><b>시작 후에 참가</b>(하루형 전용) → min(참가+5분, 회차 종료). 하루형은 시작이 자정이라
     *       "시작 전"이 영영 오지 않아 오탭 구제가 필요하다. 종료 상한이 없으면 23:58 참가의 유예가
     *       00:03 까지 살아 자정 정산(CAS)과 경합한다.</li>
     * </ul>
     *
     * <p><b>창형은 시작 후 참가에도 유예가 없다</b> — 창형의 시작 시각이 곧 취소 마감이다. 레거시 참가
     * 경로({@code createBet}·{@code joinBet}, N36 브리지)는 창형을 <b>창 종료까지</b> 열어 두므로
     * {@code createdAt >= startsAt} 인 창형 참가자가 실제로 존재한다. 그들에게 5분 유예를 주면
     * <b>진행 중인 창을 눈으로 확인한 뒤</b> 판돈을 빼는 각도가 생긴다(N22 는 하루형 오탭 구제가
     * 취지이지 창형 관전 후 이탈 허용이 아니다).
     */
    static Instant leaveDeadline(GroupChallengeBetSession session, GroupChallengeBetParticipant participant) {
        if (session.getMissionType() == MissionType.TIME_WINDOW
                || participant.getCreatedAt().isBefore(session.getStartsAt())) {
            return session.getStartsAt();
        }
        Instant graceEnd = participant.getCreatedAt().plus(LEAVE_GRACE);
        return graceEnd.isBefore(session.getClosesAt()) ? graceEnd : session.getClosesAt();
    }

    /**
     * 참가비 환불 — 경로 불문(취소·철회·탈퇴 연동) <b>단일 키</b>
     * {@code session:{sid}:refund:{participantId}} 를 쓴다(FR-42). 경로별 키를 나누면 원장 UNIQUE 가
     * 교차 경로 중복(구 E5: 취소 × 탈퇴 이중 환불)을 못 막는다. 참가 행 id 가 축이라 "참가 → 철회 →
     * 재참여" 회차도 키에서 갈린다.
     *
     * <p>앱 탈퇴자(지갑 삭제)는 지급 대상에서 뺀다({@link GroupBetSettler} 의 지급 스킵과 같은 이유).
     * 멱등키 선점(applied=false)은 잠금 후 재조회 규율 아래에서 정상 흐름에 없다 — 버그 신호로 남긴다.
     */
    private void refundStake(GroupChallengeBetSession session, User user, UUID participantId) {
        if (user.isDeleted()) {
            log.warn("내기 환불 스킵 — 탈퇴한 유저라 지갑이 없다. sessionId={}, userId={}, stake={}",
                    session.getId(), user.getId(), session.getStake());
            return;
        }
        // 여기 오는 환불은 전부 요청자 본인의 참가비다(cancelBet·leaveBet·본인 탈퇴 연동) — 남의 환불은
        // GroupBetSettler 가 TARGET 축으로 한다 (GROMO-1725, codex 4라운드).
        boolean applied = currencyLedgerService.credit(user, CurrencyTransactionType.BET_REFUND,
                session.getStake(), refundKey(session.getId(), participantId));
        if (!applied) {
            log.warn("내기 환불 스킵 — 멱등키 선점됨(버그 신호). sessionId={}, userId={}, key={}",
                    session.getId(), user.getId(), refundKey(session.getId(), participantId));
        }
    }

    /**
     * 참가 행 생성 + 참가비 차감(에스크로). 개설 브리지의 자동 참가와 일반 참가가 같은 경로를 탄다.
     *
     * <p>멱등키의 축은 유저가 아니라 <b>참가 행 id</b> 다(FR-42). 참가 행은 참가마다 새로 만들어지는
     * UUID v7 이라 "참가 → 철회 → 재참여" 회차가 키 수준에서 갈린다. userId 축이던 시절에는 재참여가
     * 같은 키를 만들어 차감이 조용히 스킵됐고, 참가비 0원 참가가 성립했다(GROMO-1112).
     */
    void stakeIn(GroupChallengeBetSession session, User user) {
        GroupChallengeBetParticipant participant = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder()
                        .session(session)
                        .user(user)
                        .build());
        // 참가 전에 쌓인 창 사용분 보고는 버린다(GROMO-1407 선기록 계열 차단) — 참가 이후의 보고만
        // 참가자 게이트를 통과한다. 무효화 본체·근거는 GroupBetWindowUsageService 에 있다.
        // 신·구 참여 경로가 전부 이 메서드를 지나므로(joinSession·joinNext·joinWeek·레거시
        // createBet/joinBet) 한 줄이면 전 경로가 덮인다 — join-week 다건도 회차마다 stakeIn 을
        // 부르므로 회차 단위 호출이 보장된다.
        groupBetWindowUsageService.invalidatePreJoinReport(session, user.getId());
        boolean applied = currencyLedgerService.debit(user, CurrencyTransactionType.BET_STAKE,
                session.getStake(), stakeKey(session.getId(), participant.getId()));
        if (!applied) {
            // 키에 참가 행 id 가 들어간 뒤로 선점은 정상 흐름에 존재하지 않는다. 조용히 넘기면 차감
            // 없는 참가 행이 남아 무임승차가 되므로 트랜잭션 전체를 되돌린다.
            log.error("참가비 차감 스킵 — 멱등키 선점됨(도달 불가). sessionId={}, userId={}, participantId={}",
                    session.getId(), user.getId(), participant.getId());
            throw new IllegalStateException("참가비 차감 멱등키 선점 — sessionId=" + session.getId()
                    + ", participantId=" + participant.getId());
        }
    }

    // ── 설정·회차 생성 (미션 스냅샷 박제) ─────────────────────────────────

    /**
     * 설정 보장 — 챌린지 1:1. 없으면 만들고, 있으면 레거시 브리지 규칙대로 최신 stake 로 갱신한다.
     * 호출부가 챌린지 행 배타 락을 쥐고 있어 동시 개설과 직렬화되지만, 유니크(challenge_id) 위반은
     * 최후 방어선으로 409 강하한다.
     */
    private GroupChallengeBet ensureBetConfig(Group group, GroupChallenge challenge, int stake) {
        Optional<GroupChallengeBet> existing =
                groupChallengeBetRepository.findByChallengeId(challenge.getId());
        if (existing.isPresent()) {
            GroupChallengeBet bet = existing.get();
            if (bet.getStake() != stake) {
                bet.updateStakeForLegacyBridge(stake);
            }
            return bet;
        }
        try {
            return groupChallengeBetRepository.saveAndFlush(GroupChallengeBet.builder()
                    .group(group)
                    .challenge(challenge)
                    .stake(stake)
                    .enabled(true)
                    .build());
        } catch (DataIntegrityViolationException e) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_EXISTS);
        }
    }

    /**
     * 회차 행 조립 — <b>미션 스냅샷 박제</b>(GROMO-1263). 실제 조립은
     * {@link GroupBetSessionFactory} 단일 지점이 하고 이 메서드는 <b>얇은 위임</b>이다.
     *
     * <p>신 참여 경로({@code GroupBetJoinService} 의 lazy 개설)와 레거시 개설 브리지·자동 개설
     * 스캔이 <b>같은 조립</b>을 써야 한다 — 사본이 둘이면 개설 경로에 따라 참가 마감·정산 시각이
     * 조용히 갈린다(회차는 그 값들을 박제하므로 되돌릴 수도 없다). B5 의 호출부를 유지하면서
     * 구현을 하나로 모으기 위해 시그니처만 남긴다.
     */
    GroupChallengeBetSession newSession(GroupChallengeBet bet, Group group,
            GroupChallenge challenge, GroupBetJudge.Target target, LocalDate sessionDate) {
        return groupBetSessionFactory.create(bet, group, challenge, target, sessionDate);
    }

    // ── 조회 조립 (GroupChallengeService 가 챌린지 카드에 얹는다) ─────────────

    /**
     * 챌린지별 "오늘의 회차"를 배치 로드한다. {@code date} 가 없으면(하위 호환 조회) 빈 맵이다.
     * 응답의 레거시 필드({@code betId}·{@code status}·{@code myJoined}·{@code participants})는
     * 오늘 회차 기준으로 그대로 채운다(N36 — shape 불변).
     *
     * <p><b>내일 폴백</b>(계약 §3 응답 보수): 조회일이 서버 KST 오늘이면, 오늘 회차가 없는 챌린지에
     * 한해 내일 OPEN 회차를 실어 준다. UNUSED(0명 종료)는 어디에도 싣지 않는다(N52).
      *
      * @param challengeIds 카드에 얹을 챌린지들 — 비면 빈 맵이다
      * @param date 조회 기준일(KST). null 이면 계산 자체를 하지 않고 빈 맵을 준다(구앱 하위 호환)
      * @param userId 카드를 보는 사람 — {@code myJoined} 같은 1인칭 필드의 기준이다
      * @param myAchievedByChallengeId 내 달성 여부(이미 계산된 값 재사용)
      * @return 챌린지별 오늘 회차. 회차가 없는 챌린지는 키가 없고, 그 부재를 「내기 꺼짐」으로 읽으면
      *     틀린다 — 설정 축은 {@link #loadBetConfigs} 가 따로 말한다
     */
    public Map<UUID, GroupBetResponse> loadCurrentBets(
            Collection<UUID> challengeIds,
            LocalDate date,
            UUID userId,
            Map<UUID, Boolean> myAchievedByChallengeId) {
        return loadCurrentBets(challengeIds, date, userId, myAchievedByChallengeId, Map.of());
    }

    /**
     * {@link #loadCurrentBets(Collection, LocalDate, UUID, Map)} + 신앱 additive 필드(GROMO-1418):
     * {@code enabled}·{@code session}(조회 date 회차 — 폴백 없음)을 함께 조립한다.
     *
     * @param challengeIds 카드에 얹을 챌린지들 — 비면 빈 맵이다
     * @param date 조회 기준일(KST). null 이면 계산 없이 빈 맵이다(구앱 하위 호환)
     * @param userId 카드를 보는 사람 — 1인칭 필드의 기준이다
     * @param myAchievedByChallengeId 내 달성 여부(이미 계산된 값 재사용)
     * @param memberProgressByChallengeId 챌린지별 멤버 진행률(카드 {@code memberProgress} 와 같은
     *     계산 결과 재사용) — 하루형 회차 참가자의 진행분 공개(N16 · FR-34)에 쓴다. 값이 null 인
     *     챌린지(미계산)는 진행분 없이 조립한다.
     * @return 챌린지별 오늘 회차 + 신앱 additive 필드. 4-인자 판과 달리 {@code session} 은
     *     조회 날짜 회차 그대로라 <b>내일 폴백이 없다</b> — 두 필드의 날짜 축이 다르다
     */
    public Map<UUID, GroupBetResponse> loadCurrentBets(
            Collection<UUID> challengeIds,
            LocalDate date,
            UUID userId,
            Map<UUID, Boolean> myAchievedByChallengeId,
            Map<UUID, List<ChallengeMemberProgressResponse>> memberProgressByChallengeId) {
        if (date == null || challengeIds.isEmpty()) {
            return Map.of();
        }
        List<GroupChallengeBetSession> sessions = new ArrayList<>(
                groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatusNot(
                        challengeIds, date, GroupBetStatus.UNUSED));
        if (date.equals(today())) {
            Set<UUID> covered = sessions.stream()
                    .map(session -> session.getChallenge().getId())
                    .collect(Collectors.toSet());
            List<UUID> uncovered = challengeIds.stream()
                    .filter(challengeId -> !covered.contains(challengeId))
                    .toList();
            if (!uncovered.isEmpty()) {
                // 내일 폴백은 OPEN 만 싣는다 — 아직 시작도 안 한 판이라 정산 결과가 있을 수 없다.
                sessions.addAll(groupChallengeBetSessionRepository
                        .findByChallengeIdInAndSessionDateAndStatus(
                                uncovered, date.plusDays(1), GroupBetStatus.OPEN));
            }
        }
        if (sessions.isEmpty()) {
            return Map.of();
        }

        Map<UUID, List<GroupChallengeBetParticipant>> participantsBySession =
                participantsBySession(sessions);
        // 시작 전 회차의 라이브 명단에서 뺄 비활성 멤버(강퇴·탈퇴) 판정용 — 필요할 때만 조회한다
        // (시작된 회차뿐이면 필터 자체가 없다). 빈 집합을 "전원 비활성"으로 오독하지 않도록
        // 필터는 preStart 인 회차에만 적용한다.
        Set<UUID> activeMemberUserIds = sessions.stream().anyMatch(GroupBetService::preStart)
                ? activeMemberUserIdsOf(sessions)
                : Set.of();
        Map<UUID, GroupBetResponse> result = new LinkedHashMap<>();
        for (GroupChallengeBetSession session : sessions) {
            List<GroupChallengeBetParticipant> participants =
                    participantsBySession.getOrDefault(session.getId(), List.of());
            UUID challengeId = session.getChallenge().getId();
            boolean myAchievedNow = session.getSessionDate().equals(date)
                    && myAchievedByChallengeId.getOrDefault(challengeId, false);
            result.put(challengeId, GroupBetResponse.builder()
                    .betId(session.getId())
                    // 개설자 개념 소멸(GROMO-1262) — 구앱의 취소 버튼 판정(개설자 && 단독 && OPEN)이
                    // 계속 서게 최초 참가자(구 모델에서 개설자였던 사람)를 채운다. 취소 브리지도
                    // "단독 참가자 본인"이면 허용하므로 버튼과 서버 판정이 일치한다.
                    .creatorUserId(participants.stream()
                            .min(Comparator.comparing(GroupChallengeBetParticipant::getCreatedAt)
                                    .thenComparing(GroupChallengeBetParticipant::getId))
                            .map(p -> p.getUser().getId())
                            .orElse(null))
                    .date(session.getSessionDate())
                    .stake(session.getStake())
                    .pot(session.getStake() * participants.size())
                    .status(session.getStatus())
                    .myJoined(participants.stream()
                            .anyMatch(p -> p.getUser().getId().equals(userId)))
                    // 호출측 스냅샷은 조회일(오늘) 진행률이다 — 내일 폴백 회차의 판정일은 내일이라
                    // 아직 아무도 달성하지 않았다.
                    .myAchievedNow(myAchievedNow)
                    .participants(participants.stream()
                            .map(p -> GroupBetParticipantResponse.builder()
                                    .userId(p.getUser().getId())
                                    .nickname(displayNickname(p.getUser()))
                                    .build())
                            .toList())
                    // 신앱 additive(GROMO-1418) — 회차가 실린 내기는 항상 켜져 있다(끄기 경로
                    // 부재, N26 · GROMO-1426). 레거시 필드 병기와 같은 응답에 얹는다(N36 보강).
                    .enabled(Boolean.TRUE)
                    // session 은 조회 date 회차만 — 내일 폴백은 레거시 필드 전용이다(신앱의 내일
                    // 축은 nextSessionAt · nextSessionJoined 가 담당).
                    .session(session.getSessionDate().equals(date)
                            ? toSessionResponse(session, participants, userId, myAchievedNow,
                                    memberProgressByChallengeId.get(challengeId), activeMemberUserIds)
                            : null)
                    .build());
        }
        return result;
    }

    /**
     * 챌린지별 <b>내기 설정</b>(카드 최상위 {@code betConfig} — GROMO-1418 · codex ① 후속) —
     * 회차 유무와 <b>무관하게</b> "이 챌린지에 내기가 걸려 있고 참가비는 얼마인가"만 말한다.
     *
     * <p>이 축을 {@code bet} 과 <b>분리한</b> 이유: {@code bet} 은 구앱 계약상 "오늘 열린 판"이라
     * {@code betId} 가 유효해야 하는데, 회차가 없는 날(마지막 참가자 취소로 회차 행 삭제 / lazy
     * 개설 전)엔 그 자리에 넣을 값이 없다. 설정을 {@code bet} 에 욱여넣으면 구앱이 판도 없는데
     * 참가 버튼을 세우려다 개설 동선까지 잃는다 — 회차가 없으면 {@code bet} 은 종전대로 null 이고,
     * 구앱은 「내기 걸기」를 눌러 레거시 createBet 브리지(설정 보장 + 당일 회차 개설 + 참가)를 탄다.
     * 신앱은 회차 유무를 {@code bet.session} 이 아니라 이 필드로 판단한다.
     *
     * <p>참여할 수 없는 곳에는 실리지 않는다 — 꺼진 설정·끝난(ACTIVE 아님)·삭제된 챌린지는 빠져
     * {@code betConfig} 가 null 이 된다(= 내기 진입점 없음).
      *
      * @param challengeIds 설정을 물어볼 챌린지들 — 비면 빈 맵이다
      * @return 챌린지별 내기 설정. 꺼진 설정·ACTIVE 아닌·삭제된 챌린지는 키가 없고,
      *     그 부재가 곧 「내기 진입점 없음」이다(회차 유무와는 다른 축이다)
     */
    public Map<UUID, GroupBetConfigResponse> loadBetConfigs(Collection<UUID> challengeIds) {
        if (challengeIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, GroupBetConfigResponse> result = new LinkedHashMap<>();
        for (GroupChallengeBet bet : groupChallengeBetRepository.findEnabledByChallengeIdIn(challengeIds)) {
            result.put(bet.getChallenge().getId(), GroupBetConfigResponse.builder()
                    .enabled(bet.isEnabled())
                    .stake(bet.getStake())
                    .build());
        }
        return result;
    }

    /** 회차가 아직 시작되지 않았는가 — 라이브 명단 필터(LLD §2.1)의 단일 판정점. */
    private static boolean preStart(GroupChallengeBetSession session) {
        return Instant.now().isBefore(session.getStartsAt());
    }

    /**
     * 회차가 속한 그룹의 <b>활성</b> 멤버 userId — 강퇴·탈퇴(is_left)는 빠진다. 카드 조회는 단일
     * 그룹 스코프라 실제로는 IN 1건이다.
     */
    private Set<UUID> activeMemberUserIdsOf(Collection<GroupChallengeBetSession> sessions) {
        Set<UUID> groupIds = sessions.stream()
                .map(session -> session.getGroup().getId())
                .collect(Collectors.toSet());
        return groupMemberRepository.findByGroupIdIn(groupIds).stream()
                .map(member -> member.getUser().getId())
                .collect(Collectors.toSet());
    }

    /**
     * 오늘(조회 date) 회차의 신앱 응답 조립(GROMO-1418, LLD §2.1) — 카운트다운 축
     * ({@code joinClosesAt}·{@code myLeaveDeadlineAt})과 하루형 참가자 진행분(N16)을 싣는다.
     *
     * <p><b>라이브 명단 필터</b>(LLD §2.1 탈퇴 멤버 가시성 · 정책 C8 · codex ②): 아직 시작하지
     * 않은 회차의 명단에서는 비활성 멤버(강퇴·탈퇴)를 뺀다 — 그룹에 없는 사람이 그룹 카드의
     * 라이브 참가자로 닉네임까지 노출될 이유가 없다. <b>시작된 회차는 전원 보존</b>한다: 강퇴는
     * 참가비를 환불하지 않고 정산 대상으로 남기므로({@code GroupMemberService#kickMember}),
     * 시작 후에 지우면 정산 명단과 화면이 갈린다.
     *
     * <p>{@code pot} 은 필터와 무관하게 <b>전체 참가 인원</b> 기준이다(계약 §1) — 강퇴자의 참가비도
     * 실제로 팟에 들어 있으니 금액을 줄이면 화면이 거짓말이 된다. 표시 인원과 팟이 어긋나 보이는
     * 것은 "명단만 가린다"는 결정의 대가로 수용한다.
     */
    private GroupBetSessionResponse toSessionResponse(
            GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants,
            UUID userId,
            boolean myAchievedNow,
            List<ChallengeMemberProgressResponse> memberProgress,
            Set<UUID> activeMemberUserIds) {
        List<GroupChallengeBetParticipant> visible = preStart(session)
                ? participants.stream()
                        .filter(p -> activeMemberUserIds.contains(p.getUser().getId()))
                        .toList()
                : participants;
        // 진행분 공개는 하루형만이다(N16 — 창형은 출발선이 있어 계약상 싣지 않는다).
        Map<UUID, ChallengeMemberProgressResponse> progressByUser =
                session.getMissionType() == MissionType.DURATION && memberProgress != null
                        ? new LinkedHashMap<>(memberProgress.stream().collect(Collectors.toMap(
                                ChallengeMemberProgressResponse::getUserId, p -> p)))
                        : new LinkedHashMap<>();
        // 카드 memberProgress 는 활성 그룹원만 계산한다 — 시작된 회차에 남아 있는 강퇴·탈퇴
        // 참가자(정산 대상)는 거기 없어 진행률이 늘 null 로 보인다. 명단에 세울 거면 판정도
        // 세워야 하므로, 빠진 참가자만 따로 집계해 채운다(대상이 없으면 쿼리도 없다).
        if (session.getMissionType() == MissionType.DURATION && !preStart(session)) {
            progressByUser.putAll(progressOfMissingParticipants(session, visible, progressByUser.keySet()));
        }
        Optional<GroupChallengeBetParticipant> mine = participants.stream()
                .filter(p -> p.getUser().getId().equals(userId))
                .findFirst();
        return GroupBetSessionResponse.builder()
                .sessionId(session.getId())
                .sessionDate(session.getSessionDate())
                .stake(session.getStake())
                .goalMinutes(session.getGoalMinutes())
                .pot(session.getStake() * participants.size())
                .status(session.getStatus())
                .startsAt(session.getStartsAt())
                .joinClosesAt(session.getJoinClosesAt())
                // 취소 마감(N22)은 참가 시점 분기라 서버 계산이 정본이다 — 미참여·종료 회차는
                // 취소 진입점 자체가 없어 null.
                .myLeaveDeadlineAt(session.isOpen()
                        ? mine.map(p -> leaveDeadline(session, p)).orElse(null)
                        : null)
                .closesAt(session.getClosesAt())
                .myJoined(mine.isPresent())
                .myAchievedNow(myAchievedNow)
                .participants(visible.stream()
                        .map(p -> {
                            ChallengeMemberProgressResponse progress =
                                    progressByUser.get(p.getUser().getId());
                            return GroupBetSessionParticipantResponse.builder()
                                    .userId(p.getUser().getId())
                                    .nickname(displayNickname(p.getUser()))
                                    .progressMinutes(progress != null ? progress.getProgressMinutes() : null)
                                    .achieved(progress != null ? progress.getAchieved() : null)
                                    .build();
                        })
                        .toList())
                .build();
    }

    /**
     * 카드 진행률 스냅샷에 없는 회차 참가자(강퇴·탈퇴자)의 진행률을 따로 집계한다 — 시작된 하루형
     * 회차 전용. 판정 규칙은 카드 {@code memberProgress} 와 같다: 3상 접기는 커널
     * ({@link GroupBetJudge#displayMinutes}·{@link GroupBetJudge#achievedOrNull})이 하므로
     * FOCUS 의 데이터 없음은 0분(서버 데이터라 사실), SCREEN_TIME 의 미보고는 null(판정 불가)이다.
     *
     * <p><b>실측이 없으면 참가 행의 박제값으로 폴백한다</b>(GROMO-1423 · codex) — 정산의
     * {@code GroupBetSettler.measuredOrFrozen} 과 <b>같은 축·같은 순서</b>다. 회차 시작 + 취소 마감
     * 후 계정을 탈퇴한 참가자는 {@link #freezeEvidenceForAccountErasure} 가
     * {@code achieved=true} + 실측 분을 참가 행에 박제한 뒤 통계가 nullify 되므로, 여기서 통계를
     * 다시 집계하면 FOCUS 달성자는 0분/미달성으로, SCREEN_TIME 달성자는 null/미판정으로 접혀
     * <b>정산이 쓰는 박제 결과와 카드 명단이 어긋난다</b>. 폴백은 이 한 곳에만 둔다 — 결과·내역
     * 경로({@link #toResultParticipants})는 정산이 참가 행에 남긴 값을 그대로 읽으므로 판정 지점이
     * 늘지 않는다.
     *
     * <p><b>순서를 뒤집지 않는다</b>: 실측이 있으면 언제나 실측이 이긴다(LLD §5.2) — 박제값을 먼저
     * 보면 조기 확정(GROMO-1268)된 살아 있는 참가자의 최신 진행분이 확정 시점 값에 덮이고, 실측
     * 0분·미보고가 낡은 값으로 뒤집힌다. {@code achieved} 는 정산과 같이 박제된 {@code true} 만
     * 불가역으로 존중한다(FR-23).
     *
     * <p>판정 대상은 <b>회차 스냅샷</b>이 정본이다(GROMO-1263 · GROMO-1280) — 카테고리·방식·목표분·
     * 창 시각을 전부 회차 행에서 읽으므로 챌린지가 이후 바뀌거나 삭제돼도 이 회차 기준은 불변이다.
     * 스냅샷이 결손인 옛 행만 커널이 CTI 로 폴백한다. 그조차 불가하면(삭제 이력 등) 조용히
     * 비운다 — 표시 경로가 500 이 되면 카드 전체가 죽는다.
     */
    private Map<UUID, ChallengeMemberProgressResponse> progressOfMissingParticipants(
            GroupChallengeBetSession session,
            List<GroupChallengeBetParticipant> participants,
            Set<UUID> alreadyKnownUserIds) {
        List<GroupChallengeBetParticipant> missing = participants.stream()
                .filter(p -> !alreadyKnownUserIds.contains(p.getUser().getId()))
                .toList();
        if (missing.isEmpty()) {
            return Map.of();
        }
        // 정산·참가 가드와 같은 커널·같은 박제값을 탄다 — 여기만 CTI 를 다시 읽으면 시작된 회차의
        // 진행분이 카드와 정산에서 갈린다.
        Optional<GroupBetJudge.Target> target = groupBetJudge.ofSession(session);
        if (target.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Integer> minutesByUser = groupBetJudge.progressMinutes(target.get(),
                session.getSessionDate(),
                missing.stream().map(GroupChallengeBetParticipant::getUser).toList());
        Map<UUID, ChallengeMemberProgressResponse> filled = new LinkedHashMap<>();
        for (GroupChallengeBetParticipant participant : missing) {
            User user = participant.getUser();
            // 커널의 "값 없음 = 키 없음" 규약(3상)을 그대로 받아, 그 자리에서만 박제값으로 채운다.
            Integer measured = minutesByUser.get(user.getId());
            Integer minutes = measured != null ? measured : participant.getProgressMinutes();
            Boolean achieved = Boolean.TRUE.equals(participant.getAchieved())
                    ? Boolean.TRUE
                    : GroupBetJudge.achievedOrNull(target.get(), minutes);
            filled.put(user.getId(), ChallengeMemberProgressResponse.builder()
                    .userId(user.getId())
                    .nickname(displayNickname(user))
                    .progressMinutes(GroupBetJudge.displayMinutes(target.get(), minutes))
                    .achieved(achieved)
                    .build());
        }
        return filled;
    }

    /**
     * 다음 회차 축(신앱 카드 — GROMO-1418, LLD §2.1) — <b>오늘을 제외한</b> 다음 활성일의 회차
     * 시작 시각과 내 예약 여부를 챌린지별로 배치 조립한다.
     *
     * <ul>
     *   <li>{@code nextSessionAt}: 하루형은 다음 활성일 00:00 KST, 창형은 그 날짜의 창 시작 —
     *       {@code GroupBetSessionFactory} 의 {@code startsAt} 계산과 같은 규칙이다. 내기·목표
     *       유무와 무관한 챌린지 스케줄 축이라 창 상세만 있으면 계산한다.</li>
     *   <li>{@code nextSessionJoined}: 그 날짜 OPEN 회차에 내 참가 행이 있는가(N45 버튼 상태).
     *       회차가 아직 없으면(lazy 개설 전) false.</li>
     * </ul>
     *
     * <p>활성일 계산은 {@link #repeatDaysOf} → {@link RepeatSchedule#next} 다 — 카드의
     * {@code activeToday}·개설 스캔과 <b>같은 스케줄</b>이라 월요일 전용 챌린지의 다음 회차는
     * 화요일이 아니라 다음 월요일이다. ACTIVE 아닌 챌린지는 맵에서 빠진다(응답 null).
      *
      * @param challenges 대상 챌린지들 — ACTIVE 가 아닌 것은 맵에서 빠진다
      * @param windows 창형 챌린지의 창 상세. 창형인데 여기 상세가 없으면 시작 시각을 계산할 수 없어
      *     그 챌린지를 통째로 건너뛴다(하루형으로 간주해 자정을 주면 서지도 않을 회차를 예고하게 된다)
      * @param userId 예약 여부를 볼 사람
      * @return 챌린지별 다음 활성일 정보. 키가 없으면 「끝난 챌린지」이거나 위의 창 상세 결손이라,
      *     앱이 「null == 종료」로 단정하면 어긋난다
     */
    public Map<UUID, NextSessionInfo> loadNextSessions(
            List<GroupChallenge> challenges, Map<UUID, GroupChallengeWindow> windows, UUID userId) {
        List<GroupChallenge> actives = challenges.stream()
                .filter(c -> c.getStatus() == GroupChallengeStatus.ACTIVE)
                .toList();
        if (actives.isEmpty()) {
            return Map.of();
        }
        LocalDate today = today();
        Map<UUID, LocalDate> nextDateByChallengeId = new LinkedHashMap<>();
        Map<LocalDate, List<UUID>> challengeIdsByNextDate = new LinkedHashMap<>();
        for (GroupChallenge challenge : actives) {
            // 창형인데 창 상세가 없으면 다음 회차를 계산할 수 없다 — 시작 시각을 모르고 회차 개설도
            // 못 하는 데이터다. 하루형으로 간주해 자정을 주면 카드가 서지도 않을 회차를 예고한다.
            if (challenge.getType() == MissionType.TIME_WINDOW && windows.get(challenge.getId()) == null) {
                continue;
            }
            LocalDate nextDate = RepeatSchedule.next(repeatDaysOf(challenge), today);
            nextDateByChallengeId.put(challenge.getId(), nextDate);
            challengeIdsByNextDate.computeIfAbsent(nextDate, d -> new ArrayList<>())
                    .add(challenge.getId());
        }
        if (nextDateByChallengeId.isEmpty()) {
            return Map.of();
        }

        // 날짜별(요일 집합이 다르면 챌린지마다 갈린다) OPEN 회차 배치 조회 → 내 참가 행만 걸러
        // 예약 여부로. 날짜 수는 활성 챌린지 상한(4개, FR-1)을 넘지 않는다.
        List<GroupChallengeBetSession> nextSessions = new ArrayList<>();
        challengeIdsByNextDate.forEach((nextDate, ids) -> nextSessions.addAll(
                groupChallengeBetSessionRepository.findByChallengeIdInAndSessionDateAndStatus(
                        ids, nextDate, GroupBetStatus.OPEN)));
        Set<UUID> myJoinedChallengeIds = nextSessions.isEmpty()
                ? Set.of()
                : groupChallengeBetParticipantRepository
                        .findBySessionIdIn(nextSessions.stream()
                                .map(GroupChallengeBetSession::getId).toList())
                        .stream()
                        .filter(p -> p.getUser().getId().equals(userId))
                        .map(p -> p.getSession().getChallenge().getId())
                        .collect(Collectors.toSet());

        // 그 날짜 회차의 <b>박제</b> stake — 설정값(betConfig.stake)과 갈릴 수 있어 따로 싣는다.
        Map<UUID, Integer> nextStakeByChallengeId = nextSessions.stream()
                .collect(Collectors.toMap(s -> s.getChallenge().getId(),
                        GroupChallengeBetSession::getStake, (a, b) -> a));

        Map<UUID, NextSessionInfo> result = new LinkedHashMap<>();
        for (UUID challengeId : nextDateByChallengeId.keySet()) {
            LocalDate nextDate = nextDateByChallengeId.get(challengeId);
            GroupChallengeWindow window = windows.get(challengeId);
            Instant nextSessionAt = window != null
                    ? nextDate.atTime(window.getWindowStart()).atZone(KST).toInstant()
                    : nextDate.atStartOfDay(KST).toInstant();
            result.put(challengeId, new NextSessionInfo(nextSessionAt,
                    myJoinedChallengeIds.contains(challengeId),
                    nextStakeByChallengeId.get(challengeId)));
        }
        return result;
    }

    /**
     * 다음 회차 축 — 카드 응답의 {@code nextSessionAt}·{@code nextSessionJoined}·
     * {@code nextSessionStake} 원값.
     *
     * @param stake 그 날짜 <b>OPEN 회차에 박제된</b> 참가비. null = 회차가 아직 없다(lazy 개설 시
     *     설정값이 박제되므로 앱은 {@code betConfig.stake} 로 안내한다). 설정 stake 는 브리지 기간
     *     레거시 개설이 갱신할 수 있어(구앱이 날짜마다 다른 금액으로 개설) 이미 열린 미래 회차의
     *     박제값과 갈린다 — 예약 시트가 설정값을 쓰면 <b>안내 금액과 join-next 의 실제 차감이
     *     어긋난다</b>(설정이 낮아지면 안내보다 더 빠진다). 그래서 회차가 있으면 이 값이 정본이다.
     */
    public record NextSessionInfo(Instant nextSessionAt, boolean nextSessionJoined, Integer stake) {
    }

    /**
     * 챌린지별 "가장 최근 정산 회차"를 배치 로드한다 — 카드의 지난 내기 한 줄용.
     * {@code goalMinutes} 는 개설 시점 박제값(GROMO-1263)이다 — V39 백필 이전 정산 이력만 null.
      *
      * @param challengeIds 지난 결과를 물어볼 챌린지들 — 비면 빈 맵이다
      * @return 챌린지별 가장 최근 정산 회차. 정산 이력이 없는 챌린지는 키가 없다
     */
    public Map<UUID, GroupBetResultResponse> loadLastSettledBets(Collection<UUID> challengeIds) {
        if (challengeIds.isEmpty()) {
            return Map.of();
        }
        List<GroupChallengeBetSession> latest =
                groupChallengeBetSessionRepository.findLatestSettledByChallengeIds(challengeIds);
        if (latest.isEmpty()) {
            return Map.of();
        }

        Map<UUID, List<GroupChallengeBetParticipant>> participantsBySession =
                participantsBySession(latest);
        Map<UUID, GroupBetResultResponse> result = new LinkedHashMap<>();
        latest.forEach(session -> {
            List<GroupChallengeBetParticipant> participants =
                    participantsBySession.getOrDefault(session.getId(), List.of());
            result.put(session.getChallenge().getId(), GroupBetResultResponse.builder()
                    .betDate(session.getSessionDate())
                    .stake(session.getStake())
                    .pot(session.getStake() * participants.size())
                    .status(session.getStatus())
                    // 종료 사유(N55) — REFUNDED 가 "달성자 0명"인지 "24h 미정산 자동 환불"인지 구분.
                    .voidReason(session.getVoidReason())
                    .goalMinutes(session.getGoalMinutes())
                    .results(toResultParticipants(participants))
                    .build());
        });
        return result;
    }

    /**
     * 내기 히스토리(GROMO-1207) — 챌린지의 정산 완료 회차(SETTLED·REFUNDED·FORFEITED)를
     * {@code session_date} 내림차순 keyset 커서로 페이지네이션한다. 커서는 직전 페이지 마지막
     * 항목의 회차 id({@code betId} 필드 — 브리지 명명 유지)다.
      *
      * @param groupId 챌린지 스코프
      * @param challengeId 이력을 볼 챌린지 — 삭제된 챌린지는 진입점이 없어 {@code NOT_FOUND} 다
      * @param userId 요청자 — 이력은 그룹원 전체가 열람한다(참가자·개설자 한정이 아니다)
      * @param cursor 직전 페이지 마지막 항목의 회차 id. null 이면 첫 페이지다
      * @param size 페이지 크기 — 범위 밖이면 {@code INVALID_PAGE_REQUEST} 400
      * @return 정산 완료 회차 한 페이지(최신순). 취소된 회차는 「없던 일」이라 실리지 않고,
      *     마지막 페이지면 {@code nextCursor} 가 null 이다
     */
    public GroupBetHistorySliceResponse getBetHistory(
            UUID groupId, UUID challengeId, UUID userId, UUID cursor, int size) {
        if (size < 1 || size > MAX_HISTORY_PAGE_SIZE) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        User user = requireActiveUserNoLock(userId);
        Group group = requireGroupMembership(user, groupId);
        // 삭제된 챌린지의 히스토리는 진입점(챌린지 카드)이 없다 — 조회 경로 공통 규칙대로 404.
        groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.CHALLENGE_NOT_FOUND));

        Slice<GroupChallengeBetSession> slice;
        if (cursor == null) {
            slice = groupChallengeBetSessionRepository.findSettledHistoryFirstPage(
                    challengeId, HISTORY_STATUSES, PageRequest.of(0, size));
        } else {
            // 커서는 챌린지 스코프로 해석 — 남의 챌린지 회차 id 로 임의 날짜 필터를 만들 수 없다.
            LocalDate cursorDate = groupChallengeBetSessionRepository
                    .findSessionDateByIdAndChallengeId(cursor, challengeId)
                    .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
            slice = groupChallengeBetSessionRepository.findSettledHistoryAfterCursor(
                    challengeId, HISTORY_STATUSES, cursorDate, PageRequest.of(0, size));
        }
        List<GroupChallengeBetSession> pageSessions = slice.getContent();
        Map<UUID, List<GroupChallengeBetParticipant>> participantsBySession =
                pageSessions.isEmpty() ? Map.of() : participantsBySession(pageSessions);

        List<GroupBetHistoryItemResponse> content = pageSessions.stream()
                .map(session -> {
                    List<GroupChallengeBetParticipant> participants =
                            participantsBySession.getOrDefault(session.getId(), List.of());
                    return GroupBetHistoryItemResponse.builder()
                            .betId(session.getId())
                            .betDate(session.getSessionDate())
                            .stake(session.getStake())
                            .pot(session.getStake() * participants.size())
                            .status(session.getStatus())
                            // 종료 사유(N55) — 내역에서도 환불 사유가 구분돼야 한다.
                            .voidReason(session.getVoidReason())
                            .settledAt(session.getSettledAt())
                            .goalMinutes(session.getGoalMinutes())
                            .results(toResultParticipants(participants))
                            .build();
                })
                .toList();
        UUID nextCursor = slice.hasNext() && !pageSessions.isEmpty()
                ? pageSessions.get(pageSessions.size() - 1).getId()
                : null;
        return new GroupBetHistorySliceResponse(content, size, slice.hasNext(), nextCursor);
    }

    /**
     * 정산 결과 참가자 한 줄 변환 — 최근 정산({@code loadLastSettledBets})·히스토리·참가자 스코프
     * 결과 조회({@code GroupBetQueryService}) 공용. 탈퇴자는 닉네임만
     * {@link #WITHDRAWN_USER_NICKNAME} 로 치환한다(GROMO-1220, D1) —
     * 명단·인원수·pot 은 정산 당시 사실이라 절대 불변이다(계약 §1).
     */
    static List<GroupBetResultParticipantResponse> toResultParticipants(
            List<GroupChallengeBetParticipant> participants) {
        return participants.stream()
                .map(p -> GroupBetResultParticipantResponse.builder()
                        .userId(p.getUser().getId())
                        .nickname(displayNickname(p.getUser()))
                        .achieved(p.getAchieved())
                        .payout(p.getPayout())
                        .progressMinutes(p.getProgressMinutes())
                        .build())
                .toList();
    }

    /**
     * 명단 표시용 닉네임 — 탈퇴자(is_deleted, PII 파기로 nickname=null)는 고정 문구로 치환한다.
     * 탈퇴자 처리를 <b>출력(명단) 층에서만</b> 하는 계약(§1)의 단일 지점이다.
     */
    static String displayNickname(User user) {
        return user.isDeleted() ? WITHDRAWN_USER_NICKNAME : user.getNickname();
    }

    private Map<UUID, List<GroupChallengeBetParticipant>> participantsBySession(
            Collection<GroupChallengeBetSession> sessions) {
        List<UUID> sessionIds = sessions.stream().map(GroupChallengeBetSession::getId).toList();
        return groupChallengeBetParticipantRepository.findBySessionIdIn(sessionIds).stream()
                .collect(Collectors.groupingBy(p -> p.getSession().getId()));
    }

    // ── 공용 가드 ────────────────────────────────────────────────────────

    /** 멱등키 컨벤션 — 참가비 차감. 축은 유저가 아니라 <b>참가 행</b>이다(FR-42). */
    static String stakeKey(UUID sessionId, UUID participantId) {
        return "session:" + sessionId + ":stake:" + participantId;
    }

    /**
     * 멱등키 컨벤션 — 환불 <b>단일 축</b>(FR-42): 취소·철회·탈퇴·무산·24h 어떤 경로든 같은 키다.
     * 정산 지급 키는 {@link GroupBetSettler#payoutKey}.
     */
    static String refundKey(UUID sessionId, UUID participantId) {
        return "session:" + sessionId + ":refund:" + participantId;
    }

    static LocalDate today() {
        return LocalDate.ofInstant(Instant.now(), KST);
    }

    /**
     * 챌린지의 활성 요일 마스크(§A3 · GROMO-1260) — 회차가 서는 날의 단일 소유자
     * {@link RepeatSchedule} 이 해석한다. 신 참여({@code GroupBetJoinService.repeatDaysOf})·자동
     * 개설 스캔({@code GroupBetSessionOpeningService})·카드의 {@code activeToday} 와 <b>같은 원값</b>
     * ({@code challenge.getRepeatDays()})을 같은 유틸에 넘긴다 — 스케줄 판정이 경로마다 갈리면
     * "카드는 쉬는 날인데 참가비는 빠지는" 상태가 된다.
     *
     * <p>이 브리지 경로 둘이 이 값을 함께 먹는다 — 한쪽만 배선하면 "개설은 되는데 다음 회차는
     * 다른 날"이 되므로 한 지점으로 묶어 둔다:
     * <ul>
     *   <li>{@code createBet} 의 활성 요일 가드 — 비활성 요일 개설을 {@code BET_CLOSED} 로 막는다.
     *       구앱에 없던 409 가 쉬는 요일에 새로 생기지만, 대안은 <b>월요일 전용 챌린지의 화요일
     *       회차에 참가비가 걷히는 것</b>이라 돈 경로가 계약 보수보다 우선한다. 응답 shape(N36 —
     *       {@code betId}·{@code status}·{@code myJoined}·{@code participants})은 불변이다.</li>
     *   <li>{@link #loadNextSessions} 의 다음 활성일 — 실제 다음 활성일을 예고한다(종전에는 쉬는
     *       날에도 항상 "내일"을 안내해, 회차가 서지도 않을 날짜를 카드가 예고했다).</li>
     * </ul>
     *
     * <p>V34 로 기존 행은 EVERYDAY(127)로 백필됐고 DB CHECK 가 1~127 을 강제하므로 마스크는 항상
     * 유효하다 — 방어적 폴백을 두지 않는다(무효값은 드러나야 한다).
     */
    int repeatDaysOf(GroupChallenge challenge) {
        return challenge.getRepeatDays();
    }

    /**
     * 회차 스냅샷 기반 판정 대상 — 참가 가드·창 마감 검사가 <b>정산과 같은 커널·같은 박제값</b>을
     * 본다(GROMO-1263 · GROMO-1280). 챌린지가 이후 바뀌거나 삭제돼도 이 회차의 기준은 불변이다.
     */
    GroupBetJudge.Target targetOf(GroupChallengeBetSession session) {
        // 스냅샷이 정본이다 — CTI 를 먼저 읽고 목표분만 덮어쓰던 종전 판(창 시각은 챌린지 현재값을
        // 따라갔다)은 커널의 ofSession 으로 대체됐다(GROMO-1280). 챌린지가 삭제·수정돼도 회차의
        // 판정 기준은 개설 시점 그대로다.
        return groupBetJudge.ofSession(session)
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801) — 락 없는 findById 면 계정 탈퇴(유저 행 배타 락)와 직렬화되지
     * 않아, 탈퇴의 참가자 스냅샷 이후에 커밋된 참가가 정리에서 빠진다.
     */
    User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForShare(userId);
    }

    /**
     * 활성 검증의 <b>락 없는</b> 판 (GROMO-1230) — 순수 읽기(readOnly) 조회 경로 전용.
     * Postgres 가 read-only 트랜잭션에서 FOR SHARE 를 거절하고, 순수 조회는 잠글 이유도 없다.
     */
    private User requireActiveUserNoLock(UUID userId) {
        return userQueryService.getCaller(userId);
    }

    /** 조회 경로용 멤버십 검증 — 잠금 없음. 돈이 움직이는 경로는 {@link #requireGroupMembershipForShare}. */
    private Group requireGroupMembership(User user, UUID groupId) {
        Group group = groupQueryService.getGroup(groupId);
        groupQueryService.getMembership(user, group);
        return group;
    }

    /**
     * 참여(차감) 경로용 멤버십 검증 — 활성 멤버십 행을 <b>공유 잠금</b>으로 읽는다(N54 차감 직전
     * 활성 멤버십 재검증). 그룹 탈퇴({@link #releaseFromOpenBets})의 배타 잠금과 멤버십 행에서
     * 직렬화되므로, "탈퇴 정리 스캔 → leave 마킹" 사이에 새 참가가 끼어들 수 없다(1258 P0 ②) —
     * users 행 공유 락은 그룹 탈퇴와 직렬화되지 않아 이 잠금이 따로 필요하다.
     */
    Group requireGroupMembershipForShare(User user, UUID groupId) {
        Group group = groupQueryService.getGroup(groupId);
        groupMemberRepository.findActiveByUserIdAndGroupIdForShare(user.getId(), group.getId())
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        return group;
    }

    /**
     * 창형(TIME_WINDOW) 마감 — 오늘 창이 이미 끝났으면 개설·참가를 막는다. 브리지 기간의 참가
     * 마감은 종전 규칙(창 <b>종료</b>까지) 그대로다 — {@code joinClosesAt}(창 시작) 강제는 신 참여
     * API(B4)의 몫이다. DURATION 은 창이 없어 날짜 검사만으로 충분하다(마감 코드도
     * {@code BET_CLOSED} 로 같다).
     *
     * <p>⚠️ <b>브리지 되돌림 대상 ③</b>({@code GroupBetSettler#effectiveJoinDeadline} javadoc 의
     * 3곳 목록 중 하나) — 이 가드가 창 종료까지 참가를 받기 때문에 나머지 둘
     * (① {@code effectiveJoinDeadline} · ② 무산 크론 스캔 술어
     * {@code findOpenPastJoinDeadlineWithFewParticipants} 의 {@code closes_at})이 박제된
     * {@code join_closes_at} 대신 {@code closes_at} 을 쓴다. 참가 마감을
     * {@code join_closes_at} 으로 전환할 때 <b>셋을 함께</b> 되돌려야 한다.
     */
    private void requireWindowStillOpen(GroupBetJudge.Target target, LocalDate date) {
        Optional<Instant> closesAt = groupBetJudge.windowClosesAt(target, date);
        if (closesAt.isPresent() && !Instant.now().isBefore(closesAt.get())) {
            throw new GroupException(GroupErrorCode.BET_CLOSED);
        }
    }

    /**
     * 참가비를 걸 자격 — 카테고리마다 막는 방향이 반대다.
     *
     * <ul>
     *   <li><b>FOCUS</b>: 이미 달성했으면 거절({@code BET_ALREADY_ACHIEVED}) — 확정된 뒤 올라타는
     *       무위험 참가 방지(창형은 5분 관용치 포함, 카드 진행률·정산과 같은 판정 소스)</li>
     *   <li><b>SCREEN_TIME</b>: 이미 목표를 초과해 패배가 확정된 유저를 거절
     *       ({@code BET_ALREADY_FAILED}) — 질 게 정해진 참가비 투입 방지</li>
     * </ul>
     *
     * <p><b>여기서 막지 않는 것 — 측정 권한 없는 SCREEN_TIME 참여(N50, GROMO-1409)</b>. 판정 커널이
     * 권한 없는 유저를 미계측으로 보므로(GROMO-1280) 그런 유저는 이 가드를 <b>항상 통과</b>하고
     * 정산에서 FR-21 로 확정 패배한다. 권한 확인·전용 에러
     * ({@code BET_SCREENTIME_PERMISSION_REQUIRED})는 참여 가드 티켓의 몫이라 여기서 임의 코드로
     * 대신 막지 않는다 — 그 티켓이 들어오기 전까지 남는 알려진 구멍이다.
     */
    void requireEligibleToStake(GroupBetJudge.Target target, User user, LocalDate date) {
        Integer minutes = groupBetJudge.progressMinutes(target, date, List.of(user)).get(user.getId());
        if (target.category() == MissionCategory.SCREEN_TIME) {
            // 미보고(null)는 잠정 달성으로 보고 통과시킨다 — 초과가 확인된 경우에만 막는다.
            if (minutes != null && minutes > target.goalMinutes()) {
                throw new GroupException(GroupErrorCode.BET_ALREADY_FAILED);
            }
            return;
        }
        if (GroupBetJudge.isAchieved(target, minutes)) {
            throw new GroupException(GroupErrorCode.BET_ALREADY_ACHIEVED);
        }
    }
}
