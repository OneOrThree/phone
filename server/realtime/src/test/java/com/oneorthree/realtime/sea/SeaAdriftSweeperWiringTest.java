package com.oneorthree.realtime.sea;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Clock;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** 스위퍼 빈의 조건부 기동과 종료 — 가짜 협력자만으로 컨텍스트를 올린다(실 Redis·소켓 없음). */
class SeaAdriftSweeperWiringTest {

    private static final String THREAD = "sea-adrift-sweep";

    @Configuration
    @Import(SeaAdriftSweeper.class)
    static class Config {
        @Bean
        StringRedisTemplate redis() {
            return mock(StringRedisTemplate.class);
        }

        @Bean
        SeaRooms seaRooms() {
            return mock(SeaRooms.class);
        }

        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Config.class)
            .withPropertyValues("realtime.sea.adrift-sweep-seconds=3600"); // 실제 틱이 돌지 않게

    @Test
    @DisplayName("속성이 없으면 빈이 있고 전용 스레드가 살아 있다 — 컨텍스트를 닫으면 스레드가 끝난다")
    void startsByDefaultAndStopsOnClose() throws Exception {
        Set<Thread> before = sweepThreads(); // 다른 컨텍스트가 남긴 같은 이름 스레드는 제외한다
        Set<Thread> created = new HashSet<>();
        runner.run(context -> {
            assertThat(context).hasSingleBean(SeaAdriftSweeper.class);
            created.addAll(sweepThreads());
            created.removeAll(before);
            assertThat(created).isNotEmpty();
        });
        // run 이 끝나면 컨텍스트가 닫힌다 — @PreDestroy 의 shutdownNow 가 스레드를 끝낸다.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (created.stream().anyMatch(Thread::isAlive) && System.nanoTime() < deadline) {
            Thread.sleep(50);
        }
        assertThat(created).noneMatch(Thread::isAlive);
    }

    @Test
    @DisplayName("realtime.sea.adrift-sweep-enabled=false 이면 빈이 없다")
    void disabledByProperty() {
        runner.withPropertyValues("realtime.sea.adrift-sweep-enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(SeaAdriftSweeper.class));
    }

    private static Set<Thread> sweepThreads() {
        return Thread.getAllStackTraces().keySet().stream()
                .filter(t -> THREAD.equals(t.getName()) && t.isAlive())
                .collect(java.util.stream.Collectors.toSet());
    }
}
