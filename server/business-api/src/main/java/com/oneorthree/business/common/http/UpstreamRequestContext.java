package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import org.springframework.http.HttpMethod;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
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
    private final boolean strictErrorContract;
    /** 요청 범위 메모 — 조합 단계마다 만드는 {@link #forReads()} 사본이 같은 맵을 공유한다. */
    private final ConcurrentMap<Object, Object> memo;

    public UpstreamRequestContext(String requestId, UUID subject, Deadline deadline) {
        this(requestId, subject, deadline, new Cancellation(), false, false, new ConcurrentHashMap<>());
    }

    private UpstreamRequestContext(String requestId, UUID subject, Deadline deadline,
            Cancellation cancellation, boolean readOnly, boolean strictErrorContract,
            ConcurrentMap<Object, Object> memo) {
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,128}")) {
            throw new IllegalArgumentException("서버 requestId 형식이 올바르지 않습니다.");
        }
        this.requestId = requestId;
        this.subject = subject;
        this.deadline = Objects.requireNonNull(deadline, "deadline");
        this.cancellation = cancellation;
        this.readOnly = readOnly;
        this.strictErrorContract = strictErrorContract;
        this.memo = memo;
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
        Object id = attributes == null ? null
                : attributes.getAttribute(RequestEnvelopeFilter.REQUEST_ID, RequestAttributes.SCOPE_REQUEST);
        boolean strict = attributes != null && Boolean.TRUE.equals(attributes.getAttribute(
                RequestEnvelopeFilter.STRICT_ERROR_CONTRACT, RequestAttributes.SCOPE_REQUEST));
        return new UpstreamRequestContext(id instanceof String value ? value : UUID.randomUUID().toString(),
                subject, deadline, new Cancellation(), false, strict, new ConcurrentHashMap<>());
    }

    /** 화면 조합 조각 안에서 도는 중인 요청의 context. 조합 밖(단건 위임 컨트롤러)에서는 {@code null}. */
    public static UpstreamRequestContext current() {
        return CURRENT.get();
    }

    /**
     * 같은 요청 안에서 같은 상류 조회를 한 번만 내게 한다 — 동시에 도는 조각도 첫 호출을 기다렸다 같은 값을 받는다.
     * 요청이 끝나면 context 와 함께 버려지므로 요청 사이에 공유되지 않는다(전역 캐시·TTL 없음).
     * {@code load} 가 예외를 던지면 저장하지 않고 그대로 올린다. null 결과도 저장하지 않는다.
     * {@code load} 안에서 같은 context 의 {@code memo} 를 다시 부르지 않는다 — {@code computeIfAbsent} 재진입은 금지돼 있다(같은 키면 예외, 다른 키도 비트 잠금 아래라 막힐 수 있다).
     */
    @SuppressWarnings("unchecked")
    public <T> T memo(Object key, Supplier<T> load) {
        // ponytail: ConcurrentHashMap 비트 잠금 아래서 상류 호출 — 키가 소수(요청당 1~2개)라 충돌 무시. 늘면 FutureTask 로.
        return (T) memo.computeIfAbsent(key, k -> load.get());
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
        return new UpstreamRequestContext(requestId, subject, deadline, cancellation, true, true, memo);
    }

    boolean strictErrorContract() {
        return strictErrorContract;
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
