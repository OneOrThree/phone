package com.oneorthree.realtime.logging;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Predicate;

/**
 * 로그 이벤트를 «출력 순간»의 MDC 와 함께 모은다 — logback 은 이벤트 MDC 를 처음 읽을 때 복사하므로, 나중에 읽으면 이미 닫힌
 * scope 를 보게 된다. JSON provider(2555)도 출력 순간 이벤트 MDC 를 읽는다. 같은 JVM 의 두 컨텍스트가 한 logback 을 쓰므로
 * 인스턴스 구분은 로그 값(결과·id)으로 한다.
 */
public final class CapturedLogs extends AppenderBase<ILoggingEvent> implements AutoCloseable {

    /** 한 줄 — 로거 이름·포맷된 메시지·출력 순간 MDC·스레드. */
    public record Line(String logger, String message, Map<String, String> mdc, String thread) {

        public String get(String key) {
            return mdc.get(key);
        }
    }

    private final List<Line> lines = new CopyOnWriteArrayList<>();
    private final List<Logger> loggers = new ArrayList<>();

    /** 컨텍스트가 뜬 «뒤»에 붙인다 — Boot 의 로깅 초기화가 붙어 있던 appender 를 떼어 낸다. */
    public static CapturedLogs of(Class<?>... types) {
        CapturedLogs captured = new CapturedLogs();
        captured.start();
        for (Class<?> type : types) {
            Logger logger = (Logger) LoggerFactory.getLogger(type);
            logger.addAppender(captured);
            captured.loggers.add(logger);
        }
        return captured;
    }

    @Override
    protected void append(ILoggingEvent event) {
        lines.add(new Line(event.getLoggerName(), event.getFormattedMessage(), Map.copyOf(event.getMDCPropertyMap()),
                event.getThreadName()));
    }

    public List<Line> lines(Predicate<Line> filter) {
        return lines.stream().filter(filter).toList();
    }

    /** 조건에 맞는 줄이 {@code count} 개 이상 모일 때까지 기다린다(최대 {@code millis}). */
    public List<Line> await(Predicate<Line> filter, int count, long millis) throws InterruptedException {
        long deadline = System.currentTimeMillis() + millis;
        List<Line> matched = lines(filter);
        while (matched.size() < count && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
            matched = lines(filter);
        }
        return matched;
    }

    @Override
    public void close() {
        loggers.forEach(logger -> logger.detachAppender(this));
        stop();
    }

    /** 이 이벤트 이름·결과 문구를 단 줄. */
    public static Predicate<Line> event(String eventName, String messagePart) {
        return line -> eventName.equals(line.get(LogContext.EVENT_NAME)) && line.message().contains(messagePart);
    }
}
