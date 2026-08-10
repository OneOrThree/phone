package com.oneorthree.phone.group.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

/**
 * 스크린타임 창 사용분 보고(GROMO-1407, N34·N43) — {@code GroupChallengeService} 의 보고 경로를
 * 회차 연동이 생기며 분리했다(계약 §5 — 챌린지 서비스는 B1 소유 생성·검증부, 회차 연동은 새 클래스).
 *
 * <p><b>신뢰성(N34)</b>: 보고에 클라 측정 시각({@code measuredAt})을 함께 저장하고, 저장값보다
 * 오래된 보고는 <b>조용히 204 로 무시</b>한다(upsert 의 조건부 갱신 — 마지막 도착 승리 폐기).
 * 미래 시각(서버 +{@link #MEASURED_AT_TOLERANCE} 초과)은 {@code INVALID_MEASURED_AT} 400 으로
 * 거절한다 — 기기 시계가 앞서 있으면 이후의 정상 보고가 전부 "오래된 값"으로 버려져 낮은 사용분이
 * 굳고, 스크린타임은 낮을수록 유리하므로 오달성으로 이긴다. 정산(finalize) 후 지연 도착한 중간
 * 보고가 최종 보고를 덮던 기존 경로도 같은 비교가 닫는다(중간 보고의 measured_at 이 더 오래됐다).
 *
 * <p><b>자격(N43)은 보고 날짜의 회차에 결속된다</b> — 두 갈래다:
 * <ul>
 *   <li><b>돈이 걸린 갈래</b>: {@code usageDate} 회차의 <b>참가자</b>면, 그 회차가 <b>시작됐고
 *       OPEN</b> 일 때만 저장한다(아니면 조용히 204). 그룹 멤버가 아니어도 받는다 — C8·N19 로
 *       탈퇴자도 시작된 회차의 정산 대상이라, 멤버 전용이면 마지막 창 사용분을 영영 못 보내고
 *       SCREEN_TIME 은 미보고 = 미달성이라 <b>목표를 지켜도 패배 확정</b>된다.</li>
 *   <li><b>표시용 갈래</b>: 그 날짜에 내 참가 행이 없는 순수 그룹 멤버의 보고는 종전대로 받는다
 *       (FR-9 카드 진행률 — 판정은 참가자만 대상이라 돈과 무관하다). 내기가 꺼진 챌린지는 회차
 *       자체가 없어 이 갈래로만 돈다. <b>단 회차가 있고 아직 시작 전이면 이 갈래도 무시</b>한다 —
 *       미참가 상태로 낮은 값을 심어두고 <b>창 시작 전에 참가</b>하면 참가자 결속을 우회하기
 *       때문이다(창형은 참가 마감 = 창 시작이라 시작 후 합류가 없어 이 한 줄로 닫힌다). 시작 전
 *       창에는 표시할 사용분이 없으므로 FR-9 손실은 없다.</li>
 * </ul>
 *
 * <p><b>왜 "챌린지의 아무 시작된 OPEN 회차"로는 안 되나</b>(PR #573 codex ②): 오늘 회차 참가자가
 * {@code join-week} 로 함께 예약한 <b>미래 회차가 시작되기도 전에</b> 그 날짜의 낮은 사용량을 미리
 * 심을 수 있다 — 그날 정상 동기화가 없으면 선기록이 그대로 판정에 쓰여 부당한 승리·지급이 된다.
 * 대상 회차를 날짜로 결속해야 "시작 전 선기록"이 닫힌다.
 *
 * <p><b>정산과의 직렬화</b>(PR #573 codex ①): 참가자 갈래는 대상 회차 행을 {@code FOR UPDATE} 로
 * 잠그고 OPEN 을 재확인한 뒤 저장한다. 무락으로 "OPEN 이네" 확인만 하고 upsert 하면
 * {@link GroupBetSettler#settle} 과 경합한다 — 정산이 락을 잡고 <b>옛 값으로 패배를 확정·지급한
 * 뒤</b> 이 트랜잭션이 새 값을 써서 <b>지급 결과와 저장된 측정치가 어긋난다</b>(계약상 "정산 후
 * 보고는 무시"인데 실제로는 반영된 셈). 회차 락을 먼저 잡으면 정산이 새 값을 보거나, 보고가 정산
 * 후임을 알고 스스로 무시한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GroupBetWindowUsageService {

    /** 하루 총량 상한(분) — 창 사용분의 물리 상한. */
    static final int MAX_WINDOW_USAGE_MINUTES = 1_440;

    /** measuredAt 미래 관용치(LLD §2.1) — 서버 시각 대비 이 이상 앞서면 거절한다. */
    static final Duration MEASURED_AT_TOLERANCE = Duration.ofMinutes(2);

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final UserRepository userRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeMemberRepository groupChallengeMemberRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final WindowFocusAggregator windowFocusAggregator;

    /**
     * 창 사용분 보고 — (챌린지, 유저, 날짜)당 1행 upsert, measured_at 단조 갱신. 역전 보고는
     * 조용히 무시하고 204 다(에러로 만들면 클라 재시도 큐 없이도 생기는 정상 경합이 유저 에러가
     * 된다). 값은 <b>클라 신뢰</b>다 — 서버가 검증할 수단이 없어 범위(0~{@value #MAX_WINDOW_USAGE_MINUTES})만
     * 확인하고 그대로 저장한다(리스크 수용, 확정 정책).
     */
    @Transactional
    public void reportWindowUsage(UUID groupId, UUID challengeId, UUID userId, WindowUsageReportRequest request) {
        User user = requireActiveUser(userId);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 대상 회차 = 보고 날짜의 회차. 참가 행이 있으면 이 보고는 돈이 걸린 값이다(판정 소스).
        // 없으면(내기 꺼짐·미참가) 표시용 보고다 — 판정은 참가자만 대상이라 정산과 무관하다.
        GroupChallengeBetSession target = groupChallengeBetSessionRepository
                .findByChallengeIdAndSessionDate(challengeId, request.getUsageDate())
                .orElse(null);
        boolean participant = target != null
                && groupChallengeBetParticipantRepository.existsBySessionIdAndUserId(target.getId(), userId);
        // 자격: 참가자(탈퇴자 포함 — N43) 또는 활성 그룹 멤버. 둘 다 아니면 종전 계약대로 403.
        if (!participant && groupMemberRepository.findByUserAndGroup(user, group).isEmpty()) {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }

        GroupChallenge challenge = groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        if (challenge.getCategory() != MissionCategory.SCREEN_TIME
                || challenge.getType() != MissionType.TIME_WINDOW) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (request.getProgressMinutes() < 0 || request.getProgressMinutes() > MAX_WINDOW_USAGE_MINUTES) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        Instant measuredAt = request.getMeasuredAt();
        if (measuredAt != null && measuredAt.isAfter(Instant.now().plus(MEASURED_AT_TOLERANCE))) {
            throw new GroupException(GroupErrorCode.INVALID_MEASURED_AT);
        }

        // 회차 유무와 무관한 선기록 차단 — 회차가 아직 없는 날짜에도 걸어야 한다. 회차 기준 게이트만
        // 두면 미개설 미래 날짜에 0분을 심어 둔 뒤 개설·참가(레거시 createBet 은 보고보다 나중에
        // 회차를 만들 수 있다)해서 그 값을 정산에 태울 수 있다 — 챌린지의 창 시각으로 막는다.
        if (!challengeClockAllowsReport(challengeId, request.getUsageDate(), userId)) {
            return;   // 조용히 204
        }

        if (target != null) {
            if (participant) {
                // 돈이 걸린 갈래만 회차와 직렬화한다 — 잠금 후 재확인이라 잠금 대기 중 끝난 정산도
                // 감지된다. 조용히 204 — 시작 전 선기록·정산 후 지연 도착은 에러가 아니라 무시다.
                if (!lockedSessionAcceptsReport(target.getId(), challengeId, userId)) {
                    return;
                }
            } else if (Instant.now().isBefore(target.getStartsAt())) {
                // 미참가 멤버라도 <b>시작 전</b> 회차에는 못 쓴다 — 창형은 참가 마감 = 창 시작이라
                // (joinClosesAt == startsAt) 시작 후 참가가 불가능하고, 그래서 "심어두고 나중에
                // 참가"는 이 한 줄로 완전히 닫힌다. 잠글 필요는 없다: 아직 판정 대상이 아니고,
                // 시작 전 창에는 표시할 사용분도 없다(FR-9 손실 없음).
                log.info("창 사용분 보고 무시 — 시작 전 회차의 미참가 보고. sessionId={}, startsAt={}, userId={}",
                        target.getId(), target.getStartsAt(), userId);
                return;
            }
        }

        int applied = groupChallengeMemberRepository.upsertWindowUsage(
                Generators.timeBasedEpochRandomGenerator().generate(),
                challengeId, userId, request.getUsageDate(), request.getProgressMinutes(), measuredAt);
        log.info("창 사용분 보고 — challengeId={}, userId={}, usageDate={}, progressMinutes={}, measuredAt={}, "
                        + "participant={}, applied={}",
                challengeId, userId, request.getUsageDate(), request.getProgressMinutes(), measuredAt,
                participant, applied == 1);
    }

    /**
     * <b>참가 시 기존 보고 무효화</b>(GROMO-1407 — 선기록 <b>계열</b> 차단). 참가 경로가 참가 행을
     * 만든 <b>같은 트랜잭션</b>에서 부른다: 그 (챌린지, 유저, 회차 날짜)의 보고 행을 지워 미보고로
     * 되돌린다.
     *
     * <p><b>왜 변종을 하나씩 막지 않고 여기서 닫나</b>: 시작 전 예약 회차·회차 미개설 미래 날짜는
     * 시각 게이트로 막았지만, <b>창이 열린 뒤 아직 참가하지 않은 멤버</b>가 낮은 값을 먼저 보고하고
     * 나중에 참가하는 변종이 남는다 — 레거시 참가 경로({@code GroupBetService.joinBet})는 참가 마감을
     * {@code joinClosesAt}(창 시작)이 아니라 <b>창 종료</b>까지로 보기 때문이다(N36 브리지). 표시용
     * 보고는 계속 받아야 하므로(FR-9) 쓰기를 막는 대신 <b>참가 시점에 그때까지의 값을 버린다</b> —
     * 참가 이후의 보고는 이미 참가자 게이트를 통과해야 하니 참가 전에 심긴 값만 정확히 걸러진다.
     *
     * <p>정직한 사용자는 손해 보지 않는다: 클라가 <b>누적값</b>을 보내므로 참가 직후 다음 sync 가
     * 실제 값을 복원한다. 복원 전에 정산되는 극단은 미보고 = 미달성(FR-21)이라 <b>돈 안전 쪽</b>으로
     * 떨어진다.
     *
     * <p>창형 SCREEN_TIME 회차에만 의미가 있다 — 다른 조합은 이 테이블을 판정 소스로 쓰지 않는다.
     *
     * @param session 방금 참가한 회차(미션 스냅샷으로 조합·날짜를 읽는다)
     * @param userId  참가자
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void invalidatePreJoinReport(GroupChallengeBetSession session, UUID userId) {
        if (session.getMissionCategory() != MissionCategory.SCREEN_TIME
                || session.getMissionType() != MissionType.TIME_WINDOW) {
            return;
        }
        int cleared = groupChallengeMemberRepository.deleteWindowUsage(
                session.getChallenge().getId(), userId, session.getSessionDate());
        if (cleared > 0) {
            log.info("참가 전 창 사용분 보고 무효화 — sessionId={}, challengeId={}, userId={}, usageDate={}, 삭제 {}행",
                    session.getId(), session.getChallenge().getId(), userId, session.getSessionDate(), cleared);
        }
    }

    /**
     * 회차에 기대지 않는 시각 게이트 — <b>보고 날짜가 아직 오지 않았으면 저장하지 않는다</b>.
     *
     * <ul>
     *   <li>{@code usageDate} 가 <b>KST 오늘보다 미래</b>면 무시 — 그 날짜의 창은 시작조차 하지
     *       않았으므로 보고할 사용분이 존재할 수 없다. 회차가 아직 없는 날짜의 선기록을 막는
     *       유일한 방어선이다(회차 기준 게이트는 행이 있어야 작동한다).</li>
     *   <li>오늘이라도 <b>창 시작 전</b>이면 무시 — 창형 챌린지의 사용분은 창이 열려야 생긴다.
     *       창 상세가 없는 챌린지(레거시·목표 미설정)는 시작 시각을 알 수 없어 날짜 판정만 적용한다.</li>
     * </ul>
     *
     * <p>과거 날짜는 그대로 받는다 — 자정을 넘겨 끝나는 창의 늦은 보고·그레이스 구간 보고가 여기
     * 걸리면 안 된다(N43). 과거 날짜의 돈 판정은 회차 게이트({@link #lockedSessionAcceptsReport})가
     * 맡는다.
     *
     * @return true = 시각상 저장 가능, false = 조용히 무시할 보고
     */
    private boolean challengeClockAllowsReport(UUID challengeId, LocalDate usageDate, UUID userId) {
        LocalDate today = LocalDate.ofInstant(Instant.now(), KST);
        if (usageDate.isAfter(today)) {
            log.info("창 사용분 보고 무시 — 아직 오지 않은 날짜. challengeId={}, usageDate={}, userId={}",
                    challengeId, usageDate, userId);
            return false;
        }
        if (!usageDate.isEqual(today)) {
            return true;
        }
        GroupChallengeWindow window = groupChallengeWindowRepository.findById(challengeId).orElse(null);
        if (window == null) {
            return true;
        }
        if (Instant.now().isBefore(windowFocusAggregator.windowStartOn(today, window))) {
            log.info("창 사용분 보고 무시 — 오늘 창이 아직 시작되지 않았다. challengeId={}, usageDate={}, userId={}",
                    challengeId, usageDate, userId);
            return false;
        }
        return true;
    }

    /**
     * 대상 회차를 {@code FOR UPDATE} 로 잠그고 보고를 받을 상태인지 재확인한다 — 잠금 <b>이후</b>
     * 판정이라 잠금 대기 중 커밋된 정산·무산도 여기서 걸린다(정산과의 경합에서 늦은 쪽이 스스로
     * 무시한다). 회차 락은 정산({@link GroupBetSettler#settle})·참여·삭제와 같은 행이므로 계약 §3
     * 잠금 순서(회차 → 지갑)를 그대로 지킨다 — 이 트랜잭션은 지갑을 만지지 않는다.
     *
     * @return true = 저장해도 되는 상태(시작됨 + OPEN), false = 조용히 무시할 보고
     */
    private boolean lockedSessionAcceptsReport(UUID sessionId, UUID challengeId, UUID userId) {
        GroupChallengeBetSession locked = groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                .orElse(null);
        if (locked == null) {
            // 잠금 대기 중 회차가 사라졌다(마지막 참가자 철회 = "없던 일"). 걸린 돈이 없으니 무시.
            log.info("창 사용분 보고 무시 — 대상 회차 소멸. sessionId={}, challengeId={}, userId={}",
                    sessionId, challengeId, userId);
            return false;
        }
        if (!locked.isOpen()) {
            log.info("창 사용분 보고 무시 — 이미 정산된 회차(정산 불가역). sessionId={}, status={}, userId={}",
                    sessionId, locked.getStatus(), userId);
            return false;
        }
        if (Instant.now().isBefore(locked.getStartsAt())) {
            // 시작 전 선기록 차단 — 예약(join-week)된 미래 회차에 낮은 값을 미리 심는 경로다.
            log.info("창 사용분 보고 무시 — 아직 시작되지 않은 회차. sessionId={}, startsAt={}, userId={}",
                    sessionId, locked.getStartsAt(), userId);
            return false;
        }
        return true;
    }

    /**
     * 활성 검증 + 공유 락 + 게스트 차단 — {@code GroupChallengeService.requireActiveUser} 와 같은
     * 규율(GROMO-801·GROMO-1237): 락 없는 findById 는 계정 탈퇴(유저 행 배타 락)와 직렬화되지 않아
     * (challenge, user, date) upsert 유령 행이 남을 수 있다.
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
