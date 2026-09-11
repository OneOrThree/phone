package com.oneorthree.business.common.request;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class SignedCursorCodecTest {

    private static final byte[] OLD_KEY = "old-independent-cursor-key-32-bytes-minimum".getBytes(StandardCharsets.UTF_8);
    private static final byte[] NEW_KEY = "new-independent-cursor-key-32-bytes-minimum".getBytes(StandardCharsets.UTF_8);
    private static final Instant NOW = Instant.parse("2026-09-12T00:00:00Z");
    private final UUID user = UUID.randomUUID();
    private final CursorScope scope = scope(user, "islands", "name", 20);
    private final CursorBoundary boundary = new CursorBoundary("2026-09-11T00:00:00Z", UUID.randomUUID().toString());

    @Test
    void roundTripAndNullBoundaryPreserveKeysetAndDoNotExposeSearchOrUser() {
        SignedCursorCodec codec = codec(Map.of("old", OLD_KEY), "old", NOW);
        String token = codec.encode(scope, boundary);
        assertEquals(boundary, codec.decode(token, scope));
        assertNull(codec.decode(null, scope));
        String payload = new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8);
        assertFalse(payload.contains("private-search-text"));
        assertFalse(payload.contains(user.toString()));
        assertFalse(payload.contains("islands"));
    }

    @Test
    void signatureAndEveryScopeAxisAreValidatedBeforeReadingBoundary() {
        SignedCursorCodec codec = codec(Map.of("old", OLD_KEY), "old", NOW);
        String token = codec.encode(scope, boundary);
        invalid(codec, "", scope);
        invalid(codec, "a".repeat(4097), scope);
        invalid(codec, token.substring(0, token.length() - 2) + "xx", scope);
        invalid(codec, token.replace("old.", "missing."), scope);
        invalid(codec, token, scope(UUID.randomUUID(), "islands", "name", 20));
        invalid(codec, token, scope(user, "members", "name", 20));
        invalid(codec, token, scope(user, "islands", "created", 20));
        invalid(codec, token, scope(user, "islands", "name", 21));
        invalid(codec, token, new CursorScope(user, "islands", Map.of("q", "changed"), "name", 20));
    }

    @Test
    void expiryIsConflictAndRotationKeepsOldKeyUntilWindowCloses() {
        String token = codec(Map.of("old", OLD_KEY), "old", NOW).encode(scope, boundary);
        SignedCursorCodec rotated = codec(Map.of("old", OLD_KEY, "new", NEW_KEY), "new", NOW.plusSeconds(899));
        assertEquals(boundary, rotated.decode(token, scope));
        assertTrue(rotated.encode(scope, boundary).startsWith("new."));
        PublicApiException expired = assertThrows(PublicApiException.class,
                () -> codec(Map.of("old", OLD_KEY, "new", NEW_KEY), "new", NOW.plusSeconds(900)).decode(token, scope));
        assertEquals(ApiErrorCode.CURSOR_EXPIRED, expired.getErrorCode());
        invalid(codec(Map.of("new", NEW_KEY), "new", NOW), token, scope);
    }

    @Test
    void signingKeysAreDefensivelyCopiedAndRequireIndependentStrength() {
        byte[] original = OLD_KEY.clone();
        SignedCursorCodec codec = codec(Map.of("old", original), "old", NOW);
        String token = codec.encode(scope, boundary);
        original[0]++;
        assertEquals(boundary, codec.decode(token, scope));
        assertThrows(IllegalArgumentException.class, () -> codec(Map.of("weak", new byte[8]), "weak", NOW));
    }

    @Test
    void pageSizeOutOfRangeIsRejectedRatherThanSilentlyClamped() {
        for (int size : new int[]{0, -1, 101}) {
            PublicApiException error = assertThrows(PublicApiException.class,
                    () -> scope(user, "islands", "name", size));
            assertEquals(ApiErrorCode.OUT_OF_RANGE, error.getErrorCode());
        }
    }

    private CursorScope scope(UUID subject, String resource, String sort, int limit) {
        return new CursorScope(subject, resource, Map.of("q", "private-search-text"), sort, limit);
    }

    private SignedCursorCodec codec(Map<String, byte[]> keys, String active, Instant now) {
        return new SignedCursorCodec(keys, active, Clock.fixed(now, ZoneOffset.UTC),
                Duration.ofMinutes(15), JsonMapper.builder().build());
    }

    private void invalid(SignedCursorCodec codec, String token, CursorScope expected) {
        PublicApiException failure = assertThrows(PublicApiException.class, () -> codec.decode(token, expected));
        assertEquals(ApiErrorCode.INVALID_CURSOR, failure.getErrorCode());
        assertEquals("cursor", failure.getField());
    }
}
