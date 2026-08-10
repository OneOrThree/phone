package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.focus.service.FocusService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * orphan 집중 세션 자동 종료 스케줄러(GROMO-610).
 *
 * <p>앱 강제종료 등으로 종료(PATCH)가 오지 않아 endedAt 이 비어있는 세션이 쌓이면
 * friend 화면에 '영원히 집중중'으로 오염된다. 매시 정각에 임계값을 넘긴 진행 중 세션을
 * '시작+상한'으로 자동 종료해 오염을 회수한다.
 *
 * <p>스케줄 트리거와 정리 로직을 분리한다 — 테스트에서는 {@link FocusService#sweepOrphanSessions}
 * 를 단독 호출한다(LeagueScheduler 패턴과 동일).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FocusSessionOrphanScheduler {

    private final FocusService focusService;

    // 매시 정각(KST) orphan 정리
    // 분산 락(GROMO-1283) — 겹쳐 돌아도 종료 UPDATE 자체는 멱등이지만 같은 행을 두 번 훑는 낭비와
    // 로그 이중 계상을 막는다.
    @Scheduled(cron = "0 0 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "focus-orphan-sweep")
    public void sweepOrphanSessions() {
        int closed = focusService.sweepOrphanSessions(Instant.now());
        if (closed > 0) {
            log.info("orphan 집중 세션 자동 종료: {}건", closed);
        }
    }
}
