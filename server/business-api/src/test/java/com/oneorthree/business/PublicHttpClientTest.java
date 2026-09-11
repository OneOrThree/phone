package com.oneorthree.business;

import com.oneorthree.business.linkpreview.client.PublicAddressPolicy;
import com.oneorthree.business.linkpreview.client.PublicHttpClient;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.io.IOException;
import java.util.concurrent.Executors;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class PublicHttpClientTest {
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void classifiesResponseAndOverallDeadlineTimeouts(boolean trickle) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newCachedThreadPool();
        server.setExecutor(executor);
        server.createContext("/slow", exchange -> {
            try {
                if (trickle) {
                    exchange.getResponseHeaders().add("Content-Type", "image/png");
                    exchange.sendResponseHeaders(200, 0);
                    for (int i = 0; i < 60; i++) {
                        exchange.getResponseBody().write(1);
                        exchange.getResponseBody().flush();
                        Thread.sleep(250);
                    }
                } else {
                    Thread.sleep(15_000);
                    exchange.sendResponseHeaders(200, -1);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (IOException e) {
                // 제한 시간 후 클라이언트가 연결을 끊는 것이 정상이다.
            } finally {
                exchange.close();
            }
        });
        server.start();
        URI target = URI.create("http://example.test:" + server.getAddress().getPort() + "/slow");
        try (MockedStatic<PublicAddressPolicy> policy = mockStatic(PublicAddressPolicy.class, CALLS_REAL_METHODS)) {
            policy.when(() -> PublicAddressPolicy.parse(target.toString())).thenReturn(target);
            policy.when(() -> PublicAddressPolicy.resolve("example.test"))
                    .thenReturn(new InetAddress[]{InetAddress.getByName("127.0.0.1")});
            var client = new PublicHttpClient();
            try {
                assertThatThrownBy(() -> client.fetch(target, Map.of(), false)).hasMessage("FETCH_TIMEOUT");
            } finally {
                client.close();
            }
        } finally {
            server.stop(0);
            executor.shutdownNow();
        }
    }

    @Test
    void pinsDnsAndRevalidatesRedirectWithoutForwardingSecrets() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger completed = new AtomicInteger();
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().add("Location", "HTTP://example.test:" + server.getAddress().getPort() + "/target");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/target", exchange -> {
            if (exchange.getRequestHeaders().getFirst("X-Goog-Api-Key") == null) completed.incrementAndGet();
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, 3);
            exchange.getResponseBody().write(new byte[]{1, 2, 3});
            exchange.close();
        });
        server.createContext("/private", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1/private");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/large", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, PublicHttpClient.MAX_BYTES + 100L);
            exchange.close();
        });
        server.createContext("/disconnect", exchange -> exchange.close());
        server.start();
        String base = "http://example.test:" + server.getAddress().getPort();
        try (MockedStatic<PublicAddressPolicy> policy = mockStatic(PublicAddressPolicy.class, CALLS_REAL_METHODS)) {
            // 테스트 서버에만 동적 포트를 허용한다. 실제 클라이언트는 운영 정책을 그대로 사용한다.
            policy.when(() -> PublicAddressPolicy.parse(anyString())).thenAnswer(call -> {
                String value = ((String) call.getArgument(0)).replaceFirst("(?i)^http:", "http:");
                return value.startsWith(base + "/") ? URI.create(value) : call.callRealMethod();
            });
            policy.when(() -> PublicAddressPolicy.resolve("example.test"))
                    .thenReturn(new InetAddress[]{InetAddress.getByName("127.0.0.1")});
            var client = new PublicHttpClient();
            try {
                var response = client.fetch(URI.create(base + "/redirect"), Map.of("X-Goog-Api-Key", "secret"), false);
                assertThat(response.body()).containsExactly(1, 2, 3);
                assertThat(completed).hasValue(1);
                policy.verify(() -> PublicAddressPolicy.resolve("example.test"), times(2));
                assertThat(client.fetch(URI.create(base.replace("http:", "HTTP:") + "/target"), Map.of(), false)
                        .body()).containsExactly(1, 2, 3);
                assertThatThrownBy(() -> client.fetch(URI.create(base + "/disconnect"), Map.of(), false))
                        .isInstanceOf(IOException.class);
                assertThatThrownBy(() -> client.fetch(URI.create(base + "/private"), Map.of(), false))
                        .hasMessage("BLOCKED_ADDRESS");
                assertThatThrownBy(() -> client.fetch(URI.create(base + "/large"), Map.of(), false))
                        .hasMessage("FILE_TOO_LARGE");
                assertThatThrownBy(() -> client.fetch(URI.create(base + "/redirect"), Map.of("X-Goog-Api-Key", "secret"), true))
                        .hasMessage("REDIRECT_REJECTED");
            } finally {
                client.close();
            }
        } finally {
            server.stop(0);
        }
    }
}
