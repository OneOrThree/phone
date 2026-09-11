package com.oneorthree.business;

import com.oneorthree.business.linkpreview.client.PublicAddressPolicy;
import com.oneorthree.business.linkpreview.client.PublicHttpClient;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
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
    @Test
    void pinsDnsAndRevalidatesRedirectWithoutForwardingSecrets() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger completed = new AtomicInteger();
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().add("Location", "/target");
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
        server.start();
        String base = "http://example.test:" + server.getAddress().getPort();
        try (MockedStatic<PublicAddressPolicy> policy = mockStatic(PublicAddressPolicy.class, CALLS_REAL_METHODS)) {
            // 테스트 서버에만 동적 포트를 허용한다. 실제 클라이언트는 운영 정책을 그대로 사용한다.
            policy.when(() -> PublicAddressPolicy.parse(anyString())).thenAnswer(call -> {
                String value = call.getArgument(0);
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
