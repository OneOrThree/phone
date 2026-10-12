package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;

import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 섬별 7일 평균 스케줄 트리거 (GROMO-2257) — 크론·존·락 이름은 애노테이션이 정본이라 선언을 단언하고,
 * 「어느 날짜를 넘기는가」는 고정 시계로 확인한다. 배치 본체는 {@code IslandFocusAverageSnapshotIntegrationTest}.
 */
class IslandFocusAverageSchedulerTest {

    @Test
    @DisplayName("매일 07:00 KST 에 돌고 고유한 ShedLock 이름이 붙어 있다 — 존이 UTC 면 한낮(16:00 KST)에 돈다")
    void runsDailyAtSevenKstUnderALock() throws NoSuchMethodException {
        Method entry = IslandFocusAverageScheduler.class.getMethod("snapshotToday");

        Scheduled cron = entry.getAnnotation(Scheduled.class);
        assertThat(cron).as("@Scheduled 가 없으면 이 진입점은 운영에서 영영 안 돈다").isNotNull();
        assertThat(cron.cron()).isEqualTo("0 0 7 * * *");
        assertThat(cron.zone()).isEqualTo(ZonePolicy.KST_ID);

        SchedulerLock lock = entry.getAnnotation(SchedulerLock.class);
        assertThat(lock).as("멀티 인스턴스에서 같은 날을 동시에 적지 않게 락이 필요하다").isNotNull();
        assertThat(lock.name()).isEqualTo("island-focus-average-snapshot");
        assertThat(lock.lockAtMostFor()).isEqualTo("PT30M");
    }

    @Test
    @DisplayName("서버 시계는 UTC 지만 넘기는 날짜는 «KST 로 환산한 오늘» 이다 — 07:00 KST 는 UTC 로는 전날 22시다")
    void passesTheKstDateNotTheUtcDate() {
        IslandFocusAverageSnapshotService service = mock(IslandFocusAverageSnapshotService.class);
        // 2034-05-05 07:00:00 KST. UTC 날짜를 그대로 넘기면 2034-05-04 가 된다.
        Clock clock = Clock.fixed(Instant.parse("2034-05-04T22:00:00Z"), ZoneOffset.UTC);

        new IslandFocusAverageScheduler(service, clock).snapshotToday();

        verify(service).snapshot(LocalDate.of(2034, 5, 5));
    }
}
