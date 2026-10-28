package com.oneorthree.business.common.request;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicCurrentState;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class RequestContractsTest {

    private final JsonMapper mapper = JsonMapper.builder().build();

    @Test
    void requiredKeyRejectsMissingMalformedAndRepeatedHeadersWithoutGeneratingOne() {
        for (String value : new String[]{null, "", " ", "1-1-4-8-1",
                UUID.randomUUID() + "," + UUID.randomUUID()}) {
            PublicApiException error = assertThrows(PublicApiException.class, () -> CommandKeys.required(value));
            assertEquals(ApiErrorCode.INVALID_IDEMPOTENCY_KEY, error.getErrorCode());
        }
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Idempotency-Key", UUID.randomUUID());
        request.addHeader("Idempotency-Key", UUID.randomUUID());
        assertThrows(PublicApiException.class, () -> CommandKeys.required(request));
    }

    @Test
    void keyNormalizationAndStepDerivationPreserveCallerIdentity() {
        for (String value : new String[]{"f47ac10b-58cc-11cf-a447-001122334455",
                "f47ac10b-58cc-51cf-a447-001122334455", "00000000-0000-0000-0000-000000000000"}) {
            assertEquals(UUID.fromString(value), CommandKeys.required(value));
        }
        UUID key = UUID.randomUUID();
        assertEquals(key, CommandKeys.required(key.toString().toUpperCase()));
        assertEquals(key + ":link-claim", CommandKeys.forSteps(key).forStep("link-claim"));
        assertEquals(UUID.fromString("019f16a0-0000-7000-8000-000000000001"),
                CommandKeys.required("019f16a0-0000-7000-8000-000000000001"));
    }

    @Test
    void fingerprintNormalizesObjectAndNumericRepresentationButPreservesIntent() {
        assertEquals(fingerprint("{\"a\":1,\"b\":{\"x\":2,\"y\":null}}"),
                fingerprint("{\"b\":{\"y\":null,\"x\":2e0},\"a\":1.00}"));
        assertNotEquals(fingerprint("{}"), fingerprint("{\"a\":null}"));
        assertNotEquals(fingerprint("[1,2]"), fingerprint("[2,1]"));
        assertNotEquals(fingerprint("{\"name\":\"a\"}"), fingerprint("{\"name\":\" a\"}"));
        assertNotEquals(fingerprint("{\"expectedVersion\":1}"), fingerprint("{\"expectedVersion\":2}"));
        assertNotEquals(fingerprint("1"), fingerprint("\"1\""));
    }

    @Test
    void safeVersionRejectsMissingAndOverflowAndReturnsOnlyExplicitPublicCurrent() {
        assertEquals(0, ResourceVersions.required(0L, "expectedVersion"));
        assertThrows(PublicApiException.class, () -> ResourceVersions.required(null, "expectedVersion"));
        assertThrows(PublicApiException.class, () -> ResourceVersions.required(Long.MAX_VALUE, "expectedVersion"));
        PublicCurrentState current = new PublicCurrentState(3, Map.of("playing", false));
        PublicApiException conflict = assertThrows(PublicApiException.class,
                () -> ResourceVersions.verify(2, "expectedWalletVersion", current));
        assertEquals(ApiErrorCode.VERSION_CONFLICT, conflict.getErrorCode());
        assertEquals("expectedWalletVersion", conflict.getField());
        assertSame(current, conflict.getCurrent());
        ResourceVersions.verify(3, "expectedVersion", current);
    }

    @Test
    void versionJsonRejectsCoercionBeforeIntegralConversion() {
        assertEquals(3, ResourceVersions.fromJson(mapper.readTree("3"), "expectedVersion"));
        for (String value : new String[]{"1.5", "1.0", "\"1\"", "null", "true", "9223372036854775808"}) {
            assertThrows(PublicApiException.class,
                    () -> ResourceVersions.fromJson(mapper.readTree(value), "expectedVersion"));
        }
    }

    private String fingerprint(String json) {
        return SemanticFingerprint.of(mapper.readTree(json));
    }
}
