package com.oneorthree.phone.outbox.scheduler;

import com.oneorthree.phone.outbox.service.OutboxRelayService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * relay 주기 실행 진입점.
 *
 * <p><b>ShedLock 을 걸지 않는다.</b> 다중 인스턴스 중복은 이미 리스가 막고 있고(선점한 행은 다른
 * 워커가 못 집는다), ShedLock 을 걸면 인스턴스 하나만 일하게 되어 재전달 처리량이 절반이 된다.
 * 크론 중복이 곧 이중 실행인 정산·알림과 달리 여기서는 <b>동시에 여러 워커가 도는 것이 정상</b>이다.
 *
 * <p>이 빈은 relay 가 켜진 경우에만 만들어진다({@code OutboxRelayConfig}) — 꺼진 기동에서는 크론
 * 자체가 없다.
 */
@Slf4j
@RequiredArgsConstructor
public class OutboxRelayScheduler {

    private final OutboxRelayService relayService;

    /**
     * 미전달분을 내보낸다.
     *
     * <p>{@code fixedDelay} 다 — 한 틱이 길어지면 다음 틱이 겹치지 않고 기다린다. 겹쳐도 리스가
     * 막지만, 굳이 브로커 연결을 두 배로 만들 이유가 없다.
     */
    @Scheduled(fixedDelayString = "${outbox.relay.poll-interval}")
    public void relay() {
        try {
            int delivered = relayService.relayOnce();
            if (delivered > 0) {
                log.info("outbox relay — 전달 {}건 (worker={})", delivered, relayService.workerId());
            }
        } catch (RuntimeException e) {
            // 크론에서 예외가 새면 스케줄러가 이 작업을 영구히 멈춘다 — 그러면 미전달이 무한히 쌓인다.
            log.error("outbox relay 틱 실패 — 다음 틱에서 재시도한다", e);
        }
    }
}
