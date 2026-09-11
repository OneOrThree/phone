package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import org.springframework.http.HttpMethod;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/** 검증한 주체·서버 추적 ID·전체 예산·취소를 같은 요청의 모든 조각에 명시 전달한다. */
public final class UpstreamRequestContext {

    private static final ThreadLocal<UpstreamRequestContext> CURRENT = new ThreadLocal<>();

    private final String requestId;
    private final UUID subject;
    private final Deadline deadline;
    private final Cancellation cancellation;
    private final boolean readOnly;

    public UpstreamRequestContext(String requestId, UUID subject, Deadline deadline) {
        this(requestId, subject, deadline, new Cancellation(), false);
    }

    private UpstreamRequestContext(String requestId, UUID subject, Deadline deadline,
            Cancellation cancellation, boolean readOnly) {
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,128}")) {
            throw new IllegalArgumentException("서버 requestId 형식이 올바르지 않습니다.");
        }
        this.requestId = requestId;
        this.subject = subject;
        this.deadline = Objects.requireNonNull(deadline, "deadline");
        this.cancellation = cancellation;
        this.readOnly = readOnly;
    }

    /** 기존 동기 facade 호환. 앱 헤더는 읽지 않고 필터가 만든 서버 속성만 읽는다. */
    static UpstreamRequestContext capture(UUID subject, Deadline deadline) {
        UpstreamRequestContext bound = CURRENT.get();
        if (bound != null) {
            if (bound.deadline != deadline) {
                throw new IllegalArgumentException("조합 조각은 같은 전체 deadline을 사용해야 합니다.");
            }
            return bound;
        }
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        Object id = attributes == null ? null : attributes.getAttribute("requestId", RequestAttributes.SCOPE_REQUEST);
        return new UpstreamRequestContext(id instanceof String value ? value : UUID.randomUUID().toString(),
                subject, deadline);
    }

    public String requestId() {
        return requestId;
    }

    public UUID subject() {
        return subject;
    }

    public Deadline deadline() {
        return deadline;
    }

    UpstreamRequestContext forReads() {
        return new UpstreamRequestContext(requestId, subject, deadline, cancellation, true);
    }

    /** 기존 facade에도 명시 context를 연결하되 풀 스레드에 요청 주체가 남지 않게 복원한다. */
    <T> T within(Supplier<T> work) {
        UpstreamRequestContext previous = CURRENT.get();
        CURRENT.set(this);
        try {
            checkActive();
            return work.get();
        } finally {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        }
    }

    void validate(InternalCall call) {
        checkActive();
        if (call.onBehalfOfUserId() != null && !call.onBehalfOfUserId().equals(subject)) {
            throw new IllegalArgumentException("내부 호출 주체가 검증한 요청 context와 다릅니다.");
        }
        if (readOnly && !HttpMethod.GET.equals(call.method())) {
            throw new IllegalArgumentException("화면 병렬 조합은 독립 GET만 허용합니다.");
        }
    }

    public void checkActive() {
        if (cancelled() || Thread.currentThread().isInterrupted() || deadline.remaining().isZero()) {
            throw new UpstreamTimeoutException("요청 예산 소진 또는 취소");
        }
    }

    boolean cancelled() {
        return cancellation.cancelled.get();
    }

    Runnable onCancel(Runnable action) {
        cancellation.actions.add(action);
        if (cancelled()) {
            action.run();
        }
        return () -> cancellation.actions.remove(action);
    }

    public void cancel() {
        if (cancellation.cancelled.compareAndSet(false, true)) {
            cancellation.actions.forEach(Runnable::run);
        }
    }

    private static final class Cancellation {
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final Set<Runnable> actions = ConcurrentHashMap.newKeySet();
    }
}
