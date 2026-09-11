package com.oneorthree.business.linkpreview.client;

import com.oneorthree.business.linkpreview.exception.PreviewException;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.SocketTimeoutException;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.util.Timeout;
import org.springframework.stereotype.Component;

/** 검증한 DNS 응답을 실제 소켓 연결에 고정한다. 자동 리다이렉트·쿠키·압축은 사용하지 않는다. */
@Component
public class PublicHttpClient {

    public static final int MAX_BYTES = 10 * 1024 * 1024;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor();

    public record Resource(String mimeType, Long sizeBytes, byte[] body) {
    }

    public Resource fetch(URI uri, Map<String, String> headers, boolean metadata) throws IOException {
        URI current = uri;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        for (int hop = 0; hop <= 3; hop++) {
            current = PublicAddressPolicy.parse(current.toString());
            InetAddress[] pinned = PublicAddressPolicy.resolve(current.getHost());
            DnsResolver resolver = new DnsResolver() {
                @Override
                public InetAddress[] resolve(String host) {
                    return pinned.clone();
                }

                @Override
                public String resolveCanonicalHostname(String host) {
                    return host;
                }
            };
            var manager = PoolingHttpClientConnectionManagerBuilder.create().setDnsResolver(resolver).build();
            var config = RequestConfig.custom().setConnectionRequestTimeout(Timeout.ofSeconds(2))
                    .setResponseTimeout(Timeout.ofSeconds(5)).build();
            HttpGet request = new HttpGet(current);
            request.setHeader("User-Agent", "Gromo-LinkPreview/1.0");
            request.setHeader("Accept-Encoding", "identity");
            // Google API 인증 헤더는 첫 요청에만 전달하며 리다이렉트에는 전달하지 않는다.
            if (hop == 0) {
                headers.forEach(request::setHeader);
            }
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) {
                throw new PreviewException("FETCH_TIMEOUT");
            }
            AtomicBoolean timedOut = new AtomicBoolean();
            var cancellation = deadlines.schedule(() -> {
                timedOut.set(true);
                request.cancel();
            }, remaining, TimeUnit.NANOSECONDS);
            try (var client = HttpClients.custom().setConnectionManager(manager).setDefaultRequestConfig(config)
                    .disableRedirectHandling().disableAutomaticRetries().disableCookieManagement()
                    .disableContentCompression().build();
                    ClassicHttpResponse response = client.executeOpen(null, request, null)) {
                try {
                    int status = response.getCode();
                    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                        var location = response.getFirstHeader("Location");
                        if (location == null || hop == 3 || metadata) {
                            throw new PreviewException("REDIRECT_REJECTED");
                        }
                        URI next = PublicAddressPolicy.parse(current.resolve(location.getValue()).toString());
                        if ("https".equals(current.getScheme()) && !"https".equals(next.getScheme())) {
                            throw new PreviewException("REDIRECT_REJECTED");
                        }
                        current = next;
                        continue;
                    }
                    if (status != 200) {
                        throw new PreviewException(status == 403 || status == 404
                                ? "NOT_PUBLIC_OR_NOT_FOUND" : "UPSTREAM_ERROR");
                    }
                    var entity = response.getEntity();
                    if (entity == null || (entity.getContentEncoding() != null
                            && !"identity".equalsIgnoreCase(entity.getContentEncoding()))) {
                        throw new PreviewException("UNSUPPORTED_CONTENT");
                    }
                    String type = entity.getContentType() == null ? "application/octet-stream"
                            : entity.getContentType().split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                    long length = entity.getContentLength();
                    boolean download = metadata || type.equals("application/pdf")
                            || type.equals("image/png") || type.equals("image/jpeg") || type.equals("image/gif");
                    if (!download) {
                        return new Resource(type, length < 0 ? null : length, new byte[0]);
                    }
                    int limit = metadata ? 64 * 1024 : MAX_BYTES;
                    if (length > limit) {
                        throw new PreviewException("FILE_TOO_LARGE");
                    }
                    byte[] body = entity.getContent().readNBytes(limit + 1);
                    if (body.length > limit) {
                        throw new PreviewException("FILE_TOO_LARGE");
                    }
                    return new Resource(type, (long) body.length, body);
                } finally {
                    // 무제한 본문을 close 시 배출하지 않도록 먼저 연결을 중단한다.
                    request.cancel();
                }
            } catch (IOException e) {
                if (timedOut.get() || e instanceof SocketTimeoutException || System.nanoTime() >= deadline) {
                    throw new PreviewException("FETCH_TIMEOUT");
                }
                throw e;
            } finally {
                cancellation.cancel(false);
            }
        }
        throw new PreviewException("REDIRECT_REJECTED");
    }

    @PreDestroy
    public void close() {
        deadlines.shutdownNow();
    }
}
