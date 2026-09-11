package com.oneorthree.business.linkpreview.service;

import com.oneorthree.business.linkpreview.client.PreviewResolver;
import com.oneorthree.business.linkpreview.client.PublicAddressPolicy;
import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.repository.PreviewCache;
import com.oneorthree.business.linkpreview.repository.PreviewCache.Entry;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class PreviewService {

    private static final Logger LOG = LoggerFactory.getLogger(PreviewService.class);
    private final PreviewCache cache;
    private final PreviewResolver resolver;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(8), new ThreadPoolExecutor.AbortPolicy());

    public PreviewService(PreviewCache cache, PreviewResolver resolver) {
        this.cache = cache;
        this.resolver = resolver;
    }

    public List<Preview> request(String user, List<String> urls, String requestId) {
        cache.checkRate(user, urls.size() * 4);
        // 잘못된 요소 때문에 배치가 일부만 등록되지 않도록 먼저 모든 URL을 검증한다.
        List<URI> parsed = urls.stream().map(PublicAddressPolicy::parse).toList();
        return parsed.stream().map(uri -> requestOne(user, uri, requestId)).toList();
    }

    private Preview requestOne(String user, URI uri, String requestId) {
        String id = id(uri.toString());
        Entry existing = cache.find(user, id);
        if (existing != null) {
            LOG.info("preview_cache request_id={} preview_id={} status={}", requestId, id,
                    existing.preview().status());
            return existing.preview();
        }
        Entry pending = new Entry(new Preview(id, "PENDING", uri.toString(), null, null, null,
                null, null, null), null, UUID.randomUUID().toString());
        if (!cache.claim(user, pending)) {
            Entry concurrent = cache.find(user, id);
            return concurrent == null ? pending.preview() : concurrent.preview();
        }
        try {
            workers.execute(() -> process(user, pending, uri, requestId));
        } catch (RejectedExecutionException e) {
            Entry busy = failed(pending, "BUSY");
            cache.complete(user, pending, busy);
            LOG.info("preview_rejected request_id={} preview_id={} reason=BUSY", requestId, id);
            return busy.preview();
        }
        return pending.preview();
    }

    private void process(String user, Entry pending, URI uri, String requestId) {
        long started = System.nanoTime();
        Entry result;
        try {
            var content = resolver.resolve(uri);
            String thumbnailUrl = content.thumbnailBase64() == null ? null
                    : "/api/v1/link-previews/" + pending.preview().id() + "/thumbnail";
            result = new Entry(new Preview(pending.preview().id(), "READY", uri.toString(), content.title(),
                    content.mimeType(), content.sizeBytes(), content.provider(), thumbnailUrl, null),
                    content.thumbnailBase64(), pending.generation());
        } catch (Exception e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            result = failed(pending, e instanceof PreviewException preview ? preview.getCode() : "FETCH_FAILED");
            LOG.info("preview_failure request_id={} preview_id={} exception_type={}", requestId,
                    pending.preview().id(), e.getClass().getSimpleName());
        }
        try {
            cache.complete(user, pending, result);
        } catch (RuntimeException e) {
            // Redis 복구 후 90초 pending TTL이 끝나면 재요청으로 재생성할 수 있다.
            LOG.warn("preview_cache_write_failed request_id={} preview_id={} exception_type={}",
                    requestId, pending.preview().id(), e.getClass().getSimpleName());
        }
        LOG.info("preview_completed request_id={} preview_id={} status={} provider={}"
                + " reason={} thumbnail={} duration_ms={}",
                requestId, pending.preview().id(), result.preview().status(), result.preview().provider(),
                result.preview().errorCode(), result.thumbnailBase64() != null,
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
    }

    private Entry failed(Entry pending, String code) {
        return new Entry(new Preview(pending.preview().id(), "FAILED", pending.preview().originalUrl(),
                null, null, null, null, null, code), null, pending.generation());
    }

    public Preview get(String user, String id) {
        return getEntry(user, id).preview();
    }

    public byte[] thumbnail(String user, String id) {
        Entry entry = getEntry(user, id);
        if (entry.thumbnailBase64() == null) {
            throw new PreviewException("NOT_FOUND");
        }
        return Base64.getDecoder().decode(entry.thumbnailBase64());
    }

    private Entry getEntry(String user, String id) {
        cache.checkRate(user, 1);
        if (!id.matches("[0-9a-f]{64}")) {
            throw new PreviewException("NOT_FOUND");
        }
        Entry entry = cache.find(user, id);
        if (entry == null) {
            throw new PreviewException("NOT_FOUND");
        }
        return entry;
    }

    private String id(String url) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(url.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    @PreDestroy
    public void close() {
        workers.shutdownNow();
    }
}
