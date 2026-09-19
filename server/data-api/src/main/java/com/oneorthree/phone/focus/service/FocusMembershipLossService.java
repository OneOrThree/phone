package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * 섬 소속을 잃는 명령이 그 섬의 진행 집중 세션을 다루는 자리 (GROMO-1924, 선행 조건 #7).
 *
 * <p><b>왜 필요한가.</b> 전이(pause/resume/finish)는 활성 멤버십을 요구한다. 그래서 강퇴된 사용자의
 * 진행 세션은 어떤 전이로도 끝낼 수 없고, 다음 start 는 열린 기본 마커 때문에
 * {@code SESSION_IN_PROGRESS} 에 영원히 걸린다 — 그 사용자는 어느 섬에서도 새 세션을 못 연다.
 * 두 명령이 그 출구를 맡는다.
 * <ul>
 *   <li><b>강퇴</b> — {@link #endOnMembershipLoss}. 2026-09-18 결정 FR-D03(B1 「강제 종료, 미정산」):
 *       강퇴 TX 가 같은 잠금 아래 진행 세션을 서버 시각으로 원자 종료하고, 그 시점까지의 물고기는
 *       정산하지 않는다. 종결 사유는 {@link FocusSessionLifecycle#MEMBERSHIP_LOST} 로 남긴다.</li>
 *   <li><b>자진 탈퇴</b> — {@link #requireNoProgressingSession}. 같은 결정의 「먼저 끝내고 나가라」
 *       (관리 LLD §5 가드 거절)라, 진행 세션이 있으면 탈퇴를 409 로 막는다. 휴식(paused)도 같다.</li>
 * </ul>
 *
 * <p><b>이 도메인에 있는 이유.</b> 부르는 쪽은 {@code group}(L5)의 멤버십 writer 다. 세션 종결은
 * 집중 기록의 일이라 {@code focus}(L2)가 알고, 위에서 아래로만 부른다. {@code internal} 의 수명주기
 * 서비스에 두면 group 이 internal 을 부르는 역행이 된다. 강퇴 표면이 늘어나도(GROMO-1802 의 섬 강퇴
 * 엔드포인트 등) 모두 {@code GroupMemberService.kickMember} 를 거치면 이 종결을 함께 얻는다.
 *
 * <p><b>잠금.</b> 호출측이 이미 사용자 → 섬 행 배타 → 대상 멤버십 배타를 쥔 뒤에 부른다(MANDATORY).
 * 전이도 섬 행 → 멤버십 → 상세 순이라({@code FocusSessionLifecycleService} 선행 조건 #8), 강퇴와
 * 전이는 섬 행에서 줄을 서고 이 메서드가 상세를 잠글 때 경합하는 전이는 없다. 상세 배타는 그래도
 * 잡는다 — 섬 잠금을 거치지 않는 경로(계정 탈퇴의 벌크 정리)와의 마지막 방어다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class FocusMembershipLossService {

    private static final List<FocusSessionLifecycle> PROGRESSING =
            List.of(FocusSessionLifecycle.ACTIVE, FocusSessionLifecycle.PAUSED);

    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;
    private final FocusSessionRepository focusSessionRepository;
    /** 사건 이름·순서 축·params 는 수명주기 전이와 같은 어댑터가 정한다 — 소비측이 같은 축으로 합친다. */
    private final FocusMemberEvents focusMemberEvents;
    private final FocusPresencePort focusPresencePort;
    private final Clock clock;

    /**
     * FR-D03 — 강퇴 대상의 이 섬 진행 세션을 서버 시각으로 종결한다. 정산하지 않는다.
     *
     * <p>한 번에 한 일만 한다: 열린 구간을 닫고, 상세를 {@link FocusSessionLifecycle#MEMBERSHIP_LOST} 로,
     * 기본 마커를 {@code AUTO_CLOSED}(통계 제외 — 「미정산」)로 닫고, 섬 목록에서 지우는 사건 둘과
     * 집중 프레즌스 해제를 남긴다. 일 집계·지갑·정산 행은 만들지 않는다.
     *
     * @param userId   소속을 잃는 사용자
     * @param islandId 잃는 섬
     * @return 종결한 세션이 있었으면 {@code true}
     */
    public boolean endOnMembershipLoss(UUID userId, UUID islandId) {
        FocusSessionDetail detail = focusSessionDetailRepository
                .findProgressingByUserIdAndIslandIdForUpdate(userId, islandId, PROGRESSING)
                .orElse(null);
        if (detail == null) {
            return false;
        }
        UUID sessionId = detail.getSessionId();
        // 전이 anchor 와 같은 규칙 — 물러난 벽시계가 열린 구간을 역전시키지 않게 직전 전이 뒤로 누른다.
        // timestamptz 정밀도로 자른다 — 사건에 싣는 값과 DB 에 남는 값이 같아야 한다(수명주기 서비스와 같은 규칙).
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant t = detail.getLastTransitionAt() != null && detail.getLastTransitionAt().isAfter(now)
                ? detail.getLastTransitionAt() : now;
        List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                .findBySessionIdOrderByOrdinalAsc(sessionId);
        FocusIntervalMath.openInterval(intervals).ifPresent(open -> open.close(t));
        long activeSeconds = FocusIntervalMath.activeSecondsAsOf(intervals, t);
        detail.applyMembershipLost(t);
        focusSessionRepository.markAutoClosedIfOpen(sessionId, t);

        // 목록에서 지우는 상태값은 완료와 같다(LLD §6: completed 는 행 제거). 새 상태값을 만들지 않는다.
        focusMemberEvents.focusUpdated(userId, islandId, sessionId, FocusMemberEvents.STATUS_COMPLETED,
                detail.getSubject(), activeSeconds, t, detail.getVersion());
        focusMemberEvents.restUpdated(userId, islandId, sessionId, FocusMemberEvents.STATUS_COMPLETED,
                null, null, t, detail.getVersion());
        focusPresencePort.focusEnded(userId, focusSessionRepository.findPresenceOrderById(sessionId).orElse(null));
        log.info("소속 상실로 진행 집중 세션을 종결했습니다(FR-D03, 미정산). session={}, user={}, island={}",
                sessionId, userId, islandId);
        return true;
    }

    /**
     * 자진 탈퇴 가드 — 이 섬의 진행(active/paused) 세션이 있으면 409 다. 휴식을 종료로 위장하지 않는다.
     *
     * @throws FocusException {@link FocusErrorCode#SESSION_IN_PROGRESS}
     */
    public void requireNoProgressingSession(UUID userId, UUID islandId) {
        if (focusSessionDetailRepository.existsByUserIdAndIslandIdAndLifecycleIn(userId, islandId, PROGRESSING)) {
            throw new FocusException(FocusErrorCode.SESSION_IN_PROGRESS);
        }
    }
}
