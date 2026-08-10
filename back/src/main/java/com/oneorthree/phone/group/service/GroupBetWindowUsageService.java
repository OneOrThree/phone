package com.oneorthree.phone.group.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
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

    private final UserRepository userRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeMemberRepository groupChallengeMemberRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;

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
