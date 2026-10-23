package com.oneorthree.phone.ranking.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 기동 시 이번 주 재계산 옵션 (GROMO-2349) — 「어느 주를 넘기는가」는 고정 시계로, 「실패가 기동을 막지 않는가」는
 * 서비스 대역으로 확인한다. 「옵션을 켠 환경에서만 빈이 되고 준비 완료 이벤트에서 도는가」는 최소 컨텍스트
 * ({@link ApplicationContextRunner})로 확인한다. 재계산 본체는 {@code IslandWeeklyFocusIntegrationTest}.
 */
class IslandWeeklyFocusStartupRecomputeTest {

    /** 2026-10-22 목요일 13:30Z — 이 주의 시작은 UTC 일요일 2026-10-18 이다. */
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-22T13:30:00Z"), ZoneOffset.UTC);
    private static final LocalDate THIS_WEEK = LocalDate.of(2026, 10, 18);

    private final IslandWeeklyFocusService service = mock(IslandWeeklyFocusService.class);
    private final IslandWeeklyFocusStartupRecompute startup = new IslandWeeklyFocusStartupRecompute(service, CLOCK);
    private final Logger startupLog = (Logger) LoggerFactory.getLogger(IslandWeeklyFocusStartupRecompute.class);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void captureLogs() {
        logs.start();
        startupLog.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        startupLog.detachAppender(logs);
        logs.stop();
    }

    @Test
    @DisplayName("기동이 끝나면 이번 주의 UTC 일요일을 넘겨 재계산한다")
    void recomputesThisWeeksUtcSunday() {
        when(service.recompute(any())).thenReturn(3);

        startup.recomputeCurrentWeek();

        verify(service).recompute(THIS_WEEK);
        assertThat(logs.list).noneMatch(event -> event.getLevel() == Level.ERROR);
    }

    @Test
    @DisplayName("일요일 00:00Z 정각은 새 주의 첫 순간이다 — 전 주를 넘기지 않는다")
    void sundayMidnightBelongsToTheNewWeek() {
        Clock sundayMidnight = Clock.fixed(Instant.parse("2026-10-25T00:00:00Z"), ZoneOffset.UTC);

        new IslandWeeklyFocusStartupRecompute(service, sundayMidnight).recomputeCurrentWeek();

        verify(service).recompute(LocalDate.of(2026, 10, 25));
    }

    @Test
    @DisplayName("재계산이 예외로 끝나도 error 로그만 남기고 삼킨다 — 준비 완료 리스너의 예외는 기동을 끊는다")
    void logsAndSwallowsAFailure() {
        IllegalStateException boom = new IllegalStateException("재계산이 터졌다");
        when(service.recompute(THIS_WEEK)).thenThrow(boom);

        assertThatCode(startup::recomputeCurrentWeek).doesNotThrowAnyException();

        assertThat(logs.list).filteredOn(event -> event.getLevel() == Level.ERROR).singleElement()
                .satisfies(event -> {
                    assertThat(event.getFormattedMessage()).contains(THIS_WEEK.toString());
                    assertThat(event.getThrowableProxy().getMessage()).isEqualTo("재계산이 터졌다");
                });
    }

    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withBean(IslandWeeklyFocusService.class, () -> service)
                .withBean(Clock.class, () -> CLOCK)
                .withUserConfiguration(IslandWeeklyFocusStartupRecompute.class);
    }

    @Test
    @DisplayName("옵션 속성이 없으면 빈이 되지 않는다 — 기본 꺼짐이라 모든 기동이 테이블 잠금을 쥐지 않는다")
    void noBeanWithoutTheProperty() {
        contextRunner().run(context -> assertThat(context).doesNotHaveBean(IslandWeeklyFocusStartupRecompute.class));
    }

    @Test
    @DisplayName("옵션이 false 이면 빈이 되지 않는다")
    void noBeanWhenTheOptionIsFalse() {
        contextRunner().withPropertyValues("ranking.weekly-focus.recompute-on-startup=false")
                .run(context -> assertThat(context).doesNotHaveBean(IslandWeeklyFocusStartupRecompute.class));
    }

    @Test
    @DisplayName("옵션이 true 이면 빈이 되고, ApplicationReadyEvent 가 발행될 때 이번 주를 재계산한다")
    void recomputesThisWeekOnApplicationReady() {
        contextRunner().withPropertyValues("ranking.weekly-focus.recompute-on-startup=true").run(context -> {
            assertThat(context).hasSingleBean(IslandWeeklyFocusStartupRecompute.class);
            verify(service, never()).recompute(any());

            context.publishEvent(new ApplicationReadyEvent(new SpringApplication(), new String[0], context,
                    Duration.ZERO));

            verify(service).recompute(THIS_WEEK);
        });
    }
}
