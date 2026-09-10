package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

/**
 * 기동 시 <b>DB 정본에서 집중 프레즌스 리스를 재구축</b>한다 (GROMO-292).
 *
 * <h2>없으면 무슨 일이 나는가</h2>
 * 리스는 {@code startFocusSession} 이 지날 때만 놓인다. 그래서 <b>그 순간에 이미 진행 중이던 집중</b>은
 * 리스가 없다:
 * <ul>
 *   <li>{@code focus.presence.enabled} 를 처음 켤 때 — 켜기 전에 시작한 사람들은 세션이 끝날 때까지
 *       <b>집중 중인데 채팅에 들어가고 발신할 수 있다.</b> 롤아웃 창 전체가 규칙 밖이 된다</li>
 *   <li>Redis 를 비웠거나 데이터가 날아갔을 때 — 같은 이유로 그 시점의 모든 진행 중 집중이 규칙 밖이 된다</li>
 * </ul>
 *
 * <h2>왜 이게 «해도 되는 일»이 아니라 «해야 하는 일»인가</h2>
 * 목표 아키텍처 A19 가 공유 저장소에 못 박은 규칙이 그것이다 — <b>Redis 는 사본이라 소유자가 DB
 * 정본에서 재구축할 수 있어야 한다.</b> 이 클래스가 프레즌스 쪽의 그 재구축 경로다.
 *
 * <h2>여러 인스턴스가 동시에 돌아도 안전하다</h2>
 * 쓰기가 「더 새로운 세션일 때만」인 조건부 연산이라 같은 값을 여러 번 써도 결과가 같고, 그 사이 끝난
 * 세션은 «끝났다» 표식에 걸려 되살아나지 않는다({@code RedisFocusPresence}). 그래서 ShedLock 으로
 * 한 대만 돌게 묶지 않는다 — 묶으면 그 한 대가 실패했을 때 아무도 재구축하지 않는다.
 *
 * <p>기동 시 한 번만 돈다. 운영 중 Redis 가 비는 경우는 재기동이 덮는다 — 주기 실행으로 넓히려면
 * 그때는 잡 등록부(ShedLock)로 옮기는 편이 낫다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "focus.presence.enabled", havingValue = "true")
public class FocusPresenceReconciler {

    private final FocusSessionRepository focusSessionRepository;
    private final FocusPresencePort focusPresencePort;
    private final Clock clock;

    /**
     * 진행 중(미종료) 마커 전부에 리스를 다시 놓는다.
     *
     * <p>모수는 「지금보다 이전에 시작한 미종료 마커」 = 진행 중 전부다. 유저당 열린 마커가 1개라
     * 이 조회는 <b>동시 집중 인원</b> 규모이고, 기동 때 한 번이라 부담이 없다.
     *
     * <p>이미 끝난 집중까지 되살릴 걱정은 없다 — 조회 조건이 {@code endedAt IS NULL} 이고, 조회와
     * 쓰기 사이에 끝난 세션은 그 종료가 남긴 표식에 걸려 쓰기가 거부된다.
     *
     * <p>실패해도 기동을 막지 않는다. 재구축은 부가 작업이고, 여기서 예외를 올리면 <b>Redis 가
     * 흔들린다는 이유로 코어 API 가 뜨지 못한다</b> — 이 PR 이 곳곳에서 피한 바로 그 모양이다.
     */
    @EventListener(ApplicationReadyEvent.class)
    @Transactional(readOnly = true)
    public void restoreLeasesOnStartup() {
        try {
            Instant now = clock.instant();
            List<FocusSession> inProgress = focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(now);

            for (FocusSession session : inProgress) {
                if (session.getUser() != null) {
                    focusPresencePort.focusStarted(session.getUser().getId(), session.getId());
                }
            }

            log.info("집중 프레즌스 재구축 — 진행 중 세션 {}건", inProgress.size());
        } catch (RuntimeException e) {
            log.error("집중 프레즌스 재구축 실패 — 그 시점의 진행 중 집중은 채팅이 열린 상태로 남는다", e);
        }
    }
}
