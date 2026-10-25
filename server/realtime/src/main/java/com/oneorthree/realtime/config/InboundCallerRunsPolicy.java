package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.Counter;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * 수신 큐가 차면 제출 스레드가 처리해 읽기를 늦춘다. 프레임을 버리거나 새 스레드를 만들지 않는다.
 *
 * <p>순서 보존 채널은 처리 완료 시 다음 프레임을 제출한다. 단순 CallerRunsPolicy는 포화 중 이 호출이
 * 재귀가 되어 긴 버스트에서 스택을 소진하므로, 같은 스레드의 재진입은 바깥 루프가 이어서 처리한다.
 * 종료 중에도 Spring ExecutorSubscribableChannel의 기본 거부 fallback처럼 제출 스레드에서 처리한다.
 * 이 정책은 실행기 대기열을 제한하며 세션별 순서 보존 큐나 서비스 전체 동시성의 상한은 아니다.
 *
 * <p>제출 스레드는 프레임을 읽은 Tomcat 워커, 순서 보존 후속 프레임을 넘기는 수신 워커, 세션 종료 DISCONNECT를
 * 보내는 종료 경로(Tomcat 워커·송신 실행기)뿐이다. heartbeat 스케줄러({@code realtime-heartbeat-})는
 * {@code SimpleBrokerMessageHandler} 의 HeartbeatTask 가 clientOutboundChannel 에만 보내므로 이 실행기에
 * 제출하지 않고, 여기서 막히지 않는다. 대가: 포화가 이어지면 Tomcat 워커({@code server.tomcat.threads.max})가
 * STOMP 처리를 떠안아 같은 예산의 HTTP·핸드셰이크·종료 콜백이 늦어진다 — 지표 {@code realtime.inbound.caller.runs}.
 *
 * <p>소켓 종료 DISCONNECT 는 세션 순서 보존 큐 밖에서 오므로 이 정책이 그것을 실행기 큐에 남은 같은 세션의 CONNECT 보다
 * 먼저 처리할 수 있다. 그 늦은 프레임이 브로커 세션을 되살리지 못하게 {@link EndedSessionGuard} 가 버린다.
 */
final class InboundCallerRunsPolicy implements RejectedExecutionHandler {

    private final ThreadLocal<Deque<Runnable>> pending = new ThreadLocal<>();

    private final Counter callerRuns;

    InboundCallerRunsPolicy(Counter callerRuns) {
        this.callerRuns = callerRuns;
    }

    @Override
    public void rejectedExecution(Runnable task, ThreadPoolExecutor executor) {
        callerRuns.increment();
        Deque<Runnable> existing = pending.get();
        if (existing != null) {
            existing.addLast(task);
            return;
        }
        Deque<Runnable> tasks = new ArrayDeque<>();
        pending.set(tasks);
        tasks.addLast(task);
        Throwable failure = null;
        try {
            while (!tasks.isEmpty()) {
                try {
                    tasks.removeFirst().run();
                } catch (RuntimeException | Error ex) {
                    // 실패한 핸들러도 afterMessageHandled에서 다음 프레임을 예약할 수 있다.
                    // 이미 받은 후속 작업은 끝내고 최초 오류를 제출자에게 돌려준다.
                    if (failure == null) {
                        failure = ex;
                    }
                }
            }
        } finally {
            pending.remove();
        }
        if (failure instanceof RuntimeException exception) {
            throw exception;
        }
        if (failure instanceof Error error) {
            throw error;
        }
    }
}
