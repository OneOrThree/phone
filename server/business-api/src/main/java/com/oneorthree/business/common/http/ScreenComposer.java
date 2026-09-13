package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.CompositionCapacityExceededException;
import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** JVM 공유 bounded 조합기. 완료 순서로 오류를 관측해 느린 필수 조각 뒤에 403을 숨기지 않는다. */
@Slf4j
public final class ScreenComposer implements AutoCloseable {

    private final ThreadPoolExecutor workers;
    private final Duration budget;

    public ScreenComposer(int poolSize, int queueCapacity, Duration budget) {
        if (poolSize < 1 || queueCapacity < 1 || budget == null || budget.isZero() || budget.isNegative()) {
            throw new IllegalArgumentException("조합 실행기 설정이 올바르지 않습니다.");
        }
        this.budget = budget;
        workers = new ThreadPoolExecutor(poolSize, poolSize, 30, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(queueCapacity), runnable -> {
                    Thread thread = new Thread(runnable, "screen-composition");
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
        workers.allowCoreThreadTimeOut(true);
    }

    /** context 조회를 시작하기 전에 호출한다. 이후 모든 단계가 이 동일 예산을 사용한다. */
    public UpstreamRequestContext start(String serverRequestId, UUID verifiedSubject) {
        return new UpstreamRequestContext(serverRequestId, verifiedSubject, Deadline.startingNow(budget));
    }

    public Map<String, Object> compose(UpstreamRequestContext context, List<ReadFragment<?>> fragments) {
        context.checkActive();
        Map<String, Object> values = new LinkedHashMap<>();
        for (ReadFragment<?> fragment : fragments) {
            if (values.containsKey(fragment.name())) {
                throw new IllegalArgumentException("조각 이름은 중복될 수 없습니다.");
            }
            values.put(fragment.name(), null);
        }
        BlockingQueue<Future<FragmentResult>> completions = new LinkedBlockingQueue<>();
        List<Future<FragmentResult>> futures = new ArrayList<>();
        UpstreamRequestContext reads = context.forReads();
        boolean success = false;
        try {
            for (ReadFragment<?> fragment : fragments) {
                context.checkActive();
                FutureTask<FragmentResult> task = new FutureTask<>(
                        () -> reads.within(() -> read(fragment, reads))) {
                    @Override
                    protected void done() {
                        completions.add(this);
                    }
                };
                futures.add(task);
                workers.execute(task);
                context.checkActive();
            }
            for (int i = 0; i < fragments.size(); i++) {
                context.checkActive();
                Future<FragmentResult> completed = completions.poll(
                        context.deadline().remaining().toNanos(), TimeUnit.NANOSECONDS);
                if (completed == null) {
                    throw new UpstreamTimeoutException("화면 전체 시간 예산 소진");
                }
                FragmentResult result = completed.get();
                context.checkActive();
                values.put(result.name(), result.value());
            }
            context.checkActive();
            success = true;
            return Collections.unmodifiableMap(values);
        } catch (RejectedExecutionException e) {
            context.checkActive();
            throw new CompositionCapacityExceededException("화면 조합 실행 큐 포화", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UpstreamTimeoutException("화면 조합 취소", e);
        } catch (CancellationException e) {
            throw new UpstreamTimeoutException("화면 조합 취소", e);
        } catch (ExecutionException e) {
            context.checkActive();
            if (e.getCause() instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new IllegalStateException("화면 조각 처리 실패", e.getCause());
        } finally {
            if (!success) {
                // 먼저 실제 HTTP를 닫고 이어서 큐/대기 worker를 중단한다.
                context.cancel();
                futures.forEach(future -> {
                    future.cancel(true);
                    workers.remove((Runnable) future);
                });
            }
        }
    }

    private FragmentResult read(ReadFragment<?> fragment, UpstreamRequestContext context) {
        try {
            Object result = fragment.read().apply(context);
            context.checkActive();
            return new FragmentResult(fragment.name(), result);
        } catch (UpstreamUnavailableException | UpstreamTimeoutException e) {
            // 전체 예산/부모 취소는 optional null보다 항상 우선이다.
            context.checkActive();
            ReadFragment.TransientFailure kind = e instanceof UpstreamTimeoutException
                    ? ReadFragment.TransientFailure.TIMEOUT : ReadFragment.TransientFailure.UNAVAILABLE;
            if (fragment.required() || !fragment.allowedFailures().contains(kind)) {
                throw e;
            }
            log.warn("screen_optional_unavailable request_id={} fragment={} reason={}",
                    context.requestId(), fragment.name(), kind);
            return new FragmentResult(fragment.name(), null);
        }
    }

    @Override
    public void close() {
        workers.shutdownNow();
    }

    private record FragmentResult(String name, Object value) {
    }
}
