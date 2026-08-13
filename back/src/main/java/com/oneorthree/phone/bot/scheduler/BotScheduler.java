package com.oneorthree.phone.bot.scheduler;

import com.oneorthree.phone.bot.service.BotSimulator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * 봇 집중 세션 tick 트리거 (GROMO-1565).
 *
 * <p>스케줄 트리거와 로직을 분리해 테스트는 {@link BotSimulator} 를 직접 호출한다
 * ({@code LeagueScheduler} 와 같은 구성).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class BotScheduler {

    private final BotSimulator botSimulator;

    /**
     * 5분마다 봇 전원의 집중 상태를 맞춘다.
     *
     * <p>주기가 5분이라 세션 경계가 최대 5분 밀리는데, 사람의 시작·종료 시각도 그만큼 흔들리므로
     * 오히려 자연스럽다. 더 촘촘히 돌 이유가 없다.
     *
     * <p>분산 락 — 인스턴스가 둘이면 같은 봇에 대해 세션을 두 번 열려 시도하게 된다.
     * {@code FocusService} 의 close-then-open 이 마커를 하나로 유지하긴 하지만, 애초에 겹쳐 돌지 않는
     * 편이 낫다. 락은 주기(5분)보다 짧게 잡아 tick 이 멈춰도 다음 회차가 이어받는다.
     */
    @Scheduled(cron = "0 */5 * * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "bot-simulator-tick", lockAtMostFor = "PT4M")
    public void runBotTick() {
        BotSimulator.BotTickResult result = botSimulator.tick(Instant.now());
        // 전이가 없는 tick 이 대부분이라 조용한 회차는 로그를 남기지 않는다.
        if (!result.isQuiet()) {
            log.info("봇 집중 세션 tick — 시작 {}건, 종료 {}건, 실패 {}건",
                    result.started(), result.ended(), result.failed());
        }
    }
}
