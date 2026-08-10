package com.oneorthree.phone.group.service;

import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.dto.GroupBetParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupBetResultParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResultResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
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
     */
    static final Duration LEAVE_GRACE = Duration.ofMinutes(5);

    /** 창형 정산 그레이스(분) — 늦게 확정되는 창 데이터를 받는 여유(N12). settle_after = 창 종료 + 30분. */
    static final int WINDOW_SETTLE_GRACE_MINUTES = 30;

    /** 하루형 FOCUS 정산 그레이스(시간) — 자정 넘겨 끝난 세션 수용(기존 01:00 배치와 짝). */
    static final int DURATION_FOCUS_SETTLE_GRACE_HOURS = 1;

    /** 하루형 SCREEN_TIME 정산 그레이스(시간) — 다음날 첫 앱 실행 보고 수용(기존 12:00 배치와 짝). */
    static final int DURATION_SCREEN_TIME_SETTLE_GRACE_HOURS = 12;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeBetRepository groupChallengeBetRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final CurrencyLedgerService currencyLedgerService;
    private final GroupBetJudge groupBetJudge;

    // ── 개설 브리지 / 참가 ──────────────────────────────────────────────

    /**
     * 레거시 개설 경로(N36 브리지) — 2계층에서 "개설"은 <b>설정 보장 + 그 날짜 회차 개설 + 본인
     * 참가</b>로 해석된다. 설정이 없으면 만들고(챌린지 1:1), 이미 있으면 요청 stake 로 갱신한다
     * (회차가 자기 stake 를 박제하므로 과거 회차·정산은 불변). 응답의 {@code betId} 는 <b>회차 id</b> 다
     * — 구앱이 그 값으로 참가·취소를 호출하는 흐름이 그대로 성립한다.
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
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        if (challenge.getStatus() != GroupChallengeStatus.ACTIVE) {
            throw new GroupException(GroupErrorCode.BET_CHALLENGE_INACTIVE);
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
                    newSession(bet, group, challenge, target, sessionDate));
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
     * @param sessionId 구 API 경로의 {@code betId} — 브리지에서 회차 id 로 해석된다
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
     */
    @Transactional
    public void freezeEvidenceForAccountErasure(User user) {
        List<UUID> sessionIds =
                groupChallengeBetSessionRepository.findOpenSessionIdsByParticipantUserId(user.getId());
        for (UUID sessionId : sessionIds) {   // id 오름차순 — 잠금 순서 규약(계약 §3)
            Optional<GroupChallengeBetSession> locked = groupChallengeBetSessionRepository
                    .findByIdForUpdate(sessionId)
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
            Optional<GroupBetJudge.Target> target = groupBetJudge.resolve(session.getChallenge())
                    .map(t -> session.getGoalMinutes() == null
                            ? t
                            : new GroupBetJudge.Target(t.challenge(), session.getGoalMinutes(), t.window()));
            if (target.isEmpty()) {
                continue;
            }
            Integer minutes = groupBetJudge
                    .progressMinutes(target.get(), session.getSessionDate(), List.of(user))
                    .get(user.getId());
            if (GroupBetJudge.isAchieved(target.get(), minutes)) {
                mine.get().confirmWin(minutes == null ? 0 : minutes);
                log.info("탈퇴 판정 근거 박제 — sessionId={}, userId={}, progressMinutes={}",
                        sessionId, user.getId(), minutes);
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

    private void releaseSessions(List<UUID> sessionIds, User user) {
        // 1단계: 대상 회차 행을 id 오름차순으로 전부 잠근다 — 지갑 쓰기 없이 잠금만(계약 §3 잠금
        // 순서: 회차 전부 → 지갑). 잠금 시점에 이미 종료된 회차는 정산 결과를 존중해 제외한다.
        List<GroupChallengeBetSession> lockedOpenSessions = new ArrayList<>();
        for (UUID sessionId : sessionIds) {
            groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
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
     *   <li><b>시작 후에 참가</b>(하루형 — 시작이 자정이라 "시작 전"이 없다) → min(참가+5분, 회차 종료).
     *       종료 상한이 없으면 23:58 참가의 유예가 00:03 까지 살아 자정 정산(CAS)과 경합한다.</li>
     * </ul>
     */
    static Instant leaveDeadline(GroupChallengeBetSession session, GroupChallengeBetParticipant participant) {
        if (participant.getCreatedAt().isBefore(session.getStartsAt())) {
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
        // TODO(머지 배선 — B6/GROMO-1407): 여기에 groupBetWindowUsageService.invalidatePreJoinReport(
        // session, user.getId()) 가 들어간다(참가 전 창 사용분 선기록 무효화, @Transactional MANDATORY).
        // 이 워크트리엔 GroupBetWindowUsageService 가 없어 호출만 비워 둔다. 신·구 참여 경로가 전부 이
        // 메서드를 지나므로(joinSession·joinNext·joinWeek·레거시 createBet/joinBet) 한 줄이면 전 경로가
        // 덮인다 — join-week 다건도 회차마다 stakeIn 을 부르므로 회차 단위 호출이 보장된다.
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
     * 회차 행 조립 — <b>미션 스냅샷 박제</b>(GROMO-1263): 카테고리·방식·목표분·창 시각·참가비를
     * 챌린지·설정에서 복사한다. 챌린지가 삭제돼도 내역 한 줄이 조인 없이 온전해야 한다(N6-1).
     *
     * <p>시각 계산: 하루형은 회차일 00:00 ~ 익일 00:00(KST), 창형은 창 시작 ~ 창 종료(자정 걸침
     * 레거시 창은 익일 종료). {@code joinClosesAt} 은 LLD §1.1 정의(창형 = 창 시작, 하루형 = 회차
     * 종료)대로 박제하되, 브리지 기간의 레거시 참가 가드는 종전 규칙(창 종료까지)을 유지한다 —
     * 이 값의 강제는 신 참여 API(B4)의 몫이다.
     */
    GroupChallengeBetSession newSession(GroupChallengeBet bet, Group group,
            GroupChallenge challenge, GroupBetJudge.Target target, LocalDate sessionDate) {
        LocalTime windowStart = null;
        LocalTime windowEnd = null;
        Instant startsAt;
        Instant closesAt;
        Instant joinClosesAt;
        Instant settleAfter;
        if (target.windowed()) {
            // V35(GROMO-1406) 이후 창 시각은 KST 벽시계 time 으로 저장된다 — Instant→LocalTime
            // 변환(WindowFocusAggregator.timeOfDay)이 더는 필요 없다.
            windowStart = target.window().getWindowStart();
            windowEnd = target.window().getWindowEnd();
            startsAt = sessionDate.atTime(windowStart).atZone(KST).toInstant();
            LocalDate endDate = windowStart.isBefore(windowEnd) ? sessionDate : sessionDate.plusDays(1);
            closesAt = endDate.atTime(windowEnd).atZone(KST).toInstant();
            joinClosesAt = startsAt;
            settleAfter = closesAt.plusSeconds(WINDOW_SETTLE_GRACE_MINUTES * 60L);
        } else {
            startsAt = sessionDate.atStartOfDay(KST).toInstant();
            closesAt = sessionDate.plusDays(1).atStartOfDay(KST).toInstant();
            joinClosesAt = closesAt;
            int graceHours = target.category() == MissionCategory.SCREEN_TIME
                    ? DURATION_SCREEN_TIME_SETTLE_GRACE_HOURS
                    : DURATION_FOCUS_SETTLE_GRACE_HOURS;
            settleAfter = closesAt.plusSeconds(graceHours * 3600L);
        }
        return GroupChallengeBetSession.builder()
                .bet(bet)
                .group(group)
                .challenge(challenge)
                .sessionDate(sessionDate)
                .stake(bet.getStake())
                .goalMinutes(target.goalMinutes())
                .missionCategory(challenge.getCategory())
                .missionType(challenge.getType())
                .windowStart(windowStart)
                .windowEnd(windowEnd)
                .status(GroupBetStatus.OPEN)
                .startsAt(startsAt)
                .joinClosesAt(joinClosesAt)
                .closesAt(closesAt)
                .settleAfter(settleAfter)
                .build();
    }

    // ── 조회 조립 (GroupChallengeService 가 챌린지 카드에 얹는다) ─────────────

    /**
     * 챌린지별 "오늘의 회차"를 배치 로드한다. {@code date} 가 없으면(하위 호환 조회) 빈 맵이다.
     * 응답의 레거시 필드({@code betId}·{@code status}·{@code myJoined}·{@code participants})는
     * 오늘 회차 기준으로 그대로 채운다(N36 — shape 불변).
     *
     * <p><b>내일 폴백</b>(계약 §3 응답 보수): 조회일이 서버 KST 오늘이면, 오늘 회차가 없는 챌린지에
     * 한해 내일 OPEN 회차를 실어 준다. UNUSED(0명 종료)는 어디에도 싣지 않는다(N52).
     */
    public Map<UUID, GroupBetResponse> loadCurrentBets(
            Collection<UUID> challengeIds,
            LocalDate date,
            UUID userId,
            Map<UUID, Boolean> myAchievedByChallengeId) {
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
        Map<UUID, GroupBetResponse> result = new LinkedHashMap<>();
        for (GroupChallengeBetSession session : sessions) {
            List<GroupChallengeBetParticipant> participants =
                    participantsBySession.getOrDefault(session.getId(), List.of());
            UUID challengeId = session.getChallenge().getId();
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
                    .myAchievedNow(session.getSessionDate().equals(date)
                            && myAchievedByChallengeId.getOrDefault(challengeId, false))
                    .participants(participants.stream()
                            .map(p -> GroupBetParticipantResponse.builder()
                                    .userId(p.getUser().getId())
                                    .nickname(displayNickname(p.getUser()))
                                    .build())
                            .toList())
                    .build());
        }
        return result;
    }

    /**
     * 챌린지별 "가장 최근 정산 회차"를 배치 로드한다 — 카드의 지난 내기 한 줄용.
     * {@code goalMinutes} 는 개설 시점 박제값(GROMO-1263)이다 — V39 백필 이전 정산 이력만 null.
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
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

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
     * 정산 결과 참가자 한 줄 변환 — 최근 정산({@code loadLastSettledBets})과 히스토리 공용.
     * 탈퇴자는 닉네임만 {@link #WITHDRAWN_USER_NICKNAME} 로 치환한다(GROMO-1220, D1) —
     * 명단·인원수·pot 은 정산 당시 사실이라 절대 불변이다(계약 §1).
     */
    private List<GroupBetResultParticipantResponse> toResultParticipants(
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
    private static String displayNickname(User user) {
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
     * 회차 스냅샷 기반 판정 대상 — 참가 가드·창 마감 검사가 챌린지 CTI 를 다시 읽되, 목표분은
     * 회차 박제값(GROMO-1263)으로 덮는다(챌린지 목표가 이후 바뀌어도 이 회차의 기준은 불변).
     */
    GroupBetJudge.Target targetOf(GroupChallengeBetSession session) {
        return groupBetJudge.resolve(session.getChallenge())
                .map(t -> session.getGoalMinutes() == null
                        ? t
                        : new GroupBetJudge.Target(t.challenge(), session.getGoalMinutes(), t.window()))
                .orElseThrow(() -> new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS));
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801) — 락 없는 findById 면 계정 탈퇴(유저 행 배타 락)와 직렬화되지
     * 않아, 탈퇴의 참가자 스냅샷 이후에 커밋된 참가가 정리에서 빠진다.
     */
    User requireActiveUser(UUID userId) {
        User user = userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }

    /**
     * 활성·게스트 검증의 <b>락 없는</b> 판 (GROMO-1230) — 순수 읽기(readOnly) 조회 경로 전용.
     * Postgres 가 read-only 트랜잭션에서 FOR SHARE 를 거절하고, 순수 조회는 잠글 이유도 없다.
     */
    private User requireActiveUserNoLock(UUID userId) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }

    /** 조회 경로용 멤버십 검증 — 잠금 없음. 돈이 움직이는 경로는 {@link #requireGroupMembershipForShare}. */
    private Group requireGroupMembership(User user, UUID groupId) {
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        return group;
    }

    /**
     * 참여(차감) 경로용 멤버십 검증 — 활성 멤버십 행을 <b>공유 잠금</b>으로 읽는다(N54 차감 직전
     * 활성 멤버십 재검증). 그룹 탈퇴({@link #releaseFromOpenBets})의 배타 잠금과 멤버십 행에서
     * 직렬화되므로, "탈퇴 정리 스캔 → leave 마킹" 사이에 새 참가가 끼어들 수 없다(1258 P0 ②) —
     * users 행 공유 락은 그룹 탈퇴와 직렬화되지 않아 이 잠금이 따로 필요하다.
     */
    Group requireGroupMembershipForShare(User user, UUID groupId) {
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        groupMemberRepository.findActiveByUserIdAndGroupIdForShare(user.getId(), group.getId())
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        return group;
    }

    /**
     * 창형(TIME_WINDOW) 마감 — 오늘 창이 이미 끝났으면 개설·참가를 막는다. 브리지 기간의 참가
     * 마감은 종전 규칙(창 <b>종료</b>까지) 그대로다 — {@code joinClosesAt}(창 시작) 강제는 신 참여
     * API(B4)의 몫이다. DURATION 은 창이 없어 날짜 검사만으로 충분하다(마감 코드도
     * {@code BET_CLOSED} 로 같다).
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
