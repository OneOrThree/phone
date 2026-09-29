package com.oneorthree.business.api;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 화면 전체 deadline(3초) 소진은 504 다 (LLD §5). 느린 상류가 공유 서킷을 열어 다른 계약 테스트를 503 으로
 * 오염시키지 않게 이 클래스만 별도 컨텍스트(서킷 임계 상향)로 띄우고, 잠든 상류가 풀린 뒤에 끝낸다.
 */
@TestPropertySource(properties = "business.upstream.data.failure-threshold=1000")
class ScreenDeadlineContractTest extends ScreenContractTestBase {

    @Test
    void wholeDeadlineExhaustionIs504() throws Exception {
        String current = "GET " + USERS + "/focus-sessions/current";
        DATA.on(DATA_ME, request -> ok(ME));
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));
        AtomicBoolean first = new AtomicBoolean(true);
        CountDownLatch released = new CountDownLatch(1);
        DATA.on(current, request -> {
            if (first.getAndSet(false)) {
                try {
                    Thread.sleep(3_500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                released.countDown();
            }
            return ok("{\"session\":null}");
        });
        mockMvc.perform(auth(get("/screens/launch")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_TIMEOUT"));
        // MockUpstream 은 스레드 하나로 응답한다 — 잠든 핸들러가 풀리기 전에 끝내면 다음 테스트 클래스의 호출이
        // 그 뒤에 줄 서서 read-timeout 으로 실패하고, 공유 컨텍스트의 서킷까지 연다.
        assertThat(released.await(5, TimeUnit.SECONDS)).isTrue();
    }
}
