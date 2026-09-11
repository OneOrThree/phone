package com.oneorthree.business.linkpreview.client;

import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class PublicAddressPolicy {

    // OS DNS 호출이 중단 신호를 무시해도 대기 스레드가 무제한 늘어나지 않는다.
    private static final ThreadPoolExecutor DNS = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
            new SynchronousQueue<>(), task -> {
                Thread thread = new Thread(task, "preview-dns");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());

    private PublicAddressPolicy() {
    }

    public static URI parse(String url) {
        try {
            URI uri = URI.create(url.split("#", 2)[0]);
            String scheme = uri.getScheme() == null ? null : uri.getScheme().toLowerCase(Locale.ROOT);
            if (url.length() > 4096 || uri.getHost() == null || uri.getRawUserInfo() != null
                    || !("https".equals(scheme) || "http".equals(scheme))
                    || (uri.getPort() != -1 && uri.getPort() != ("https".equals(scheme) ? 443 : 80))) {
                throw new PreviewException("INVALID_URL");
            }
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
                    || host.endsWith(".internal") || host.endsWith(".")) {
                throw new PreviewException("BLOCKED_ADDRESS");
            }
            // 원문 escape를 보존하며 스킴만 정규화한다. 리다이렉트의 downgrade 검사도 같은 값을 사용한다.
            return URI.create(scheme + uri.toString().substring(uri.getScheme().length()));
        } catch (IllegalArgumentException e) {
            throw new PreviewException("INVALID_URL");
        }
    }

    public static InetAddress[] resolve(String host) throws UnknownHostException {
        InetAddress[] addresses;
        try {
            var lookup = DNS.submit(() -> InetAddress.getAllByName(host));
            try {
                addresses = lookup.get(2, TimeUnit.SECONDS);
            } finally {
                lookup.cancel(true);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PreviewException("FETCH_TIMEOUT");
        } catch (TimeoutException | RejectedExecutionException e) {
            throw new PreviewException("FETCH_TIMEOUT");
        } catch (ExecutionException e) {
            throw new UnknownHostException("DNS_LOOKUP_FAILED");
        }
        for (InetAddress address : addresses) {
            if (!isPublic(address)) {
                throw new PreviewException("BLOCKED_ADDRESS");
            }
        }
        return addresses;
    }

    public static boolean isPublic(InetAddress address) {
        byte[] bytes = address.getAddress();
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            return false;
        }
        int first = Byte.toUnsignedInt(bytes[0]);
        int second = Byte.toUnsignedInt(bytes[1]);
        if (bytes.length == 4) {
            int third = Byte.toUnsignedInt(bytes[2]);
            int fourth = Byte.toUnsignedInt(bytes[3]);
            return first != 0 && first != 10 && first != 127 && first < 224
                    && !(first == 100 && second >= 64 && second <= 127)
                    && !(first == 169 && second == 254)
                    && !(first == 172 && second >= 16 && second <= 31)
                    && !(first == 192 && second == 168)
                    && !(first == 192 && second == 0 && third == 0 && fourth != 9 && fourth != 10)
                    && !(first == 192 && second == 0 && third == 2)
                    && !(first == 192 && second == 88 && third == 99)
                    && !(first == 198 && (second == 18 || second == 19))
                    && !(first == 198 && second == 51 && third == 100)
                    && !(first == 203 && second == 0 && third == 113);
        }
        // IPv6는 전역 유니캐스트만 허용하고 전환·문서용 네트워크도 차단한다.
        return (first & 0xe0) == 0x20
                && !(first == 0x3f && second == 0xff && (Byte.toUnsignedInt(bytes[2]) & 0xf0) == 0)
                && !(first == 0x20 && second == 0x02)
                && !(first == 0x20 && second == 0x01
                && (Byte.toUnsignedInt(bytes[2]) < 2
                || (Byte.toUnsignedInt(bytes[2]) == 0x0d && Byte.toUnsignedInt(bytes[3]) == 0xb8)));
    }
}
