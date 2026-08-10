package com.oneorthree.phone.group.service;

import com.fasterxml.uuid.Generators;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
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
 * <p><b>자격(N43)</b>: 그룹 멤버 <b>또는</b> 이 챌린지의 <b>시작된 OPEN 회차 참가자</b>. C8·N19 로
 * 탈퇴자도 시작된 회차의 정산 대상으로 남는데, 멤버 전용이면 마지막 창 사용분을 영영 못 보낸다 —
 * SCREEN_TIME 은 미보고 = 미달성이라 목표를 지켜도 패배 확정된다. 회차가 OPEN 인 동안(정산
 * 전까지 — {@code closes_at} 이 아니다) 받는다: 참가자 자격 검사가 OPEN 게이트라 정산이 끝나면
 * 자격도 함께 닫힌다(멤버 보고는 종전대로 표시용으로 계속 받는다).
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
        requireMemberOrOpenSessionParticipant(user, group, challengeId);

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

        int applied = groupChallengeMemberRepository.upsertWindowUsage(
                Generators.timeBasedEpochRandomGenerator().generate(),
                challengeId, userId, request.getUsageDate(), request.getProgressMinutes(), measuredAt);
        log.info("창 사용분 보고 — challengeId={}, userId={}, usageDate={}, progressMinutes={}, measuredAt={}, "
                        + "applied={}",
                challengeId, userId, request.getUsageDate(), request.getProgressMinutes(), measuredAt,
                applied == 1);
    }

    /**
     * 보고 자격(N43) — 그룹 멤버 또는 이 챌린지의 시작된 OPEN 회차 참가자. 멤버십 조회가 활성
     * (is_left=false) 기준이라 탈퇴자는 자연히 참가자 축으로만 통과한다. 둘 다 아니면 종전 계약
     * 그대로 {@code MEMBER_ONLY} 403 이다.
     */
    private void requireMemberOrOpenSessionParticipant(User user, Group group, UUID challengeId) {
        if (groupMemberRepository.findByUserAndGroup(user, group).isPresent()) {
            return;
        }
        if (groupChallengeBetSessionRepository.existsStartedOpenParticipation(
                challengeId, user.getId(), Instant.now())) {
            return;
        }
        throw new GroupException(GroupErrorCode.MEMBER_ONLY);
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
