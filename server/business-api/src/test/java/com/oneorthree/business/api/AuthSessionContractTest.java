package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 소셜 로그인 세션 공개 계약 (GROMO-1908) — 실제 필터 체인 · 컨트롤러 · HTTP 로 확인한다.
 *
 * <h2>이 테스트가 «깨지도록» 만든 것</h2>
 * 상류를 고정 응답으로 두면 「재생했는가」를 검증할 수 없다 — 어느 쪽이든 같은 200 이 오기 때문이다.
 * 그래서 {@link #ledger} 가 <b>진짜 원장처럼</b> 상태를 들고 있다: 조회는 저장된 결과가 있을 때만
 * 재생을 주고, 교환 표면은 부를 때마다 카운트가 오른다. 구현이 조회를 건너뛰거나 재생 뒤에도 교환을
 * 부르면 {@code hits} 가 2 가 되어 <b>테스트가 실패한다</b>.
 */
class AuthSessionContractTest extends UpstreamTestBase {

    private static final String PATH = "/auth/sessions";
    private static final String DATA_LOOKUP = "POST /internal/auth/login-attempts/lookup";
    private static final String DATA_EXECUTE = "POST /internal/auth/login-attempts";

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001908");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001908");
    private static final String ATTEMPT = "cccccccc-0000-7000-8000-000000001908";

    private static final String APPLE_BODY = """
            {"provider":"apple","credential":{"type":"id_token","value":"apple-identity-token"},\
            "termsVersion":"2026-09"}""";
    private static final String OTHER_BODY = """
            {"provider":"apple","credential":{"type":"id_token","value":"a-different-apple-token"},\
            "termsVersion":"2026-09"}""";

    /** attemptId → 확정된 결과 JSON. 실제 {@code login_attempts} 원장이 하는 일의 최소판이다. */
    private final Map<String, String> ledger = new HashMap<>();
    /** attemptId → 그 시도에 처음 확정된 자격 digest. 「같은 키에 다른 자격」 판정용. */
    private final Map<String, String> digests = new HashMap<>();

    @BeforeEach
    void stubLedger() {
        ledger.clear();
        digests.clear();

        DATA.on(DATA_LOOKUP, request -> {
            String attemptId = field(request.body(), "attemptId");
            String digest = field(request.body(), "credentialDigest");
            String stored = digests.get(attemptId);
            if (stored != null && !stored.equals(digest)) {
                return error(409, "IDEMPOTENCY_KEY_CONFLICT");
            }
            String session = ledger.get(attemptId);
            return session == null
                    ? ok("{\"replayable\":false,\"session\":null}")
                    : ok("{\"replayable\":true,\"session\":" + session + "}");
        });

        DATA.on(DATA_EXECUTE, request -> {
            String attemptId = field(request.body(), "attemptId");
            String digest = field(request.body(), "credentialDigest");
            String stored = digests.putIfAbsent(attemptId, digest);
            if (stored != null && !stored.equals(digest)) {
                return error(409, "IDEMPOTENCY_KEY_CONFLICT");
            }
            String session = session("access-" + attemptId, "refresh-" + attemptId);
            ledger.put(attemptId, session);
            return ok(session);
        });
    }

    // ── DoD ① 응답은 정확히 네 필드다 ──────────────────────────────────────────────

    /**
     * 201 본문에 <b>네 필드만</b> 있어야 한다 (LLD §2.1).
     *
     * <p>{@code isNewUser} 와 provider subject 는 상류가 보내도 나가면 안 된다 — 그래서 상류 응답에
     * 둘을 «실어» 두고 공개 응답에서 사라지는지 본다. 필드 개수까지 세는 이유는 「있으면 안 되는
     * 것」을 이름으로 하나씩 적으면 새로 생긴 필드를 영영 못 잡기 때문이다.
     */
    @Test
    void returnsExactlyFourFieldsAndLeaksNeitherSubjectNorNewUserFlag() throws Exception {
        DATA.on(DATA_EXECUTE, request -> ok("{\"accessToken\":\"at\",\"refreshToken\":\"rt\","
                + "\"userId\":\"" + USER + "\",\"onboardingComplete\":false,"
                + "\"isNewUser\":true,\"providerSubject\":\"apple-subject-0001\","
                + "\"sessionEpoch\":7,\"nonce\":\"internal-nonce\"}"));

        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.accessToken").value("at"))
                .andExpect(jsonPath("$.data.refreshToken").value("rt"))
                .andExpect(jsonPath("$.data.userId").value(USER.toString()))
                .andExpect(jsonPath("$.data.onboardingComplete").value(false))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data.isNewUser").doesNotExist())
                .andExpect(jsonPath("$.data.providerSubject").doesNotExist())
                .andExpect(jsonPath("$.data.sessionEpoch").doesNotExist())
                .andExpect(jsonPath("$.data.nonce").doesNotExist());
    }

    /** 토큰이 빠진 상류 응답을 200 으로 접지 않는다 — 앱이 「로그인됐다」고 믿고 다음 요청에서 401 을 맞는다. */
    @ParameterizedTest
    @ValueSource(strings = {
        "{\"accessToken\":null,\"refreshToken\":\"rt\",\"userId\":\"%s\",\"onboardingComplete\":false}",
        "{\"accessToken\":\"at\",\"refreshToken\":null,\"userId\":\"%s\",\"onboardingComplete\":false}",
        "{\"accessToken\":\"at\",\"refreshToken\":\"rt\",\"userId\":null,\"onboardingComplete\":false}",
    })
    void rejectsUpstreamResultMissingAnyCredential(String template) throws Exception {
        DATA.on(DATA_EXECUTE, request -> ok(template.formatted(USER)));
        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    // ── DoD ② 같은 키·같은 본문의 재시도는 IdP 를 다시 부르지 않는다 ────────────────

    /**
     * <b>이 테스트의 핵심 단언은 {@code hits(DATA_EXECUTE) == 1} 이다.</b>
     *
     * <p>교환 표면이 IdP 를 부르는 유일한 자리이므로, 두 번의 로그인 요청에 그 표면이 한 번만 불렸다는
     * 것이 곧 「일회용 code 를 다시 교환하지 않았다」이다. 구현이 조회를 건너뛰거나 재생 뒤에도
     * 교환을 부르면 2 가 되어 실패한다.
     */
    @Test
    void replaysSameStatusAndResultWithoutASecondProviderExchange() throws Exception {
        String first = mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        String second = mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        assertThat(second).isEqualTo(first);
        assertThat(DATA.hits(DATA_EXECUTE)).as("IdP 교환 표면 호출 횟수").isEqualTo(1);
        assertThat(DATA.hits(DATA_LOOKUP)).as("교환 전 내구 조회는 매번 한다").isEqualTo(2);
    }

    /** 재개의 증거는 «원 자격» 이다 — 두 요청이 같은 digest 를 계산해야 원장이 같은 시도로 읽는다. */
    @Test
    void computesTheSameKeyedDigestForTheSameCredential() throws Exception {
        mockMvc.perform(login(APPLE_BODY)).andExpect(status().isCreated());
        mockMvc.perform(login(APPLE_BODY)).andExpect(status().isCreated());

        var lookups = DATA.receivedFor(DATA_LOOKUP);
        assertThat(lookups).hasSize(2);
        String digest = field(lookups.get(0).body(), "credentialDigest");
        assertThat(field(lookups.get(1).body(), "credentialDigest")).isEqualTo(digest);
        // 앱이 보낸 값이 아니라 서버가 계산한 값이다 — 요청 본문 어디에도 digest 가 없다.
        assertThat(APPLE_BODY).doesNotContain(digest);
        // 원 자격이 digest 로 «대체» 됐는지 본다. 조회 표면에 자격 원문이 실려 나가면 안 된다.
        assertThat(lookups.get(0).body()).doesNotContain("apple-identity-token");
    }

    /** 다른 자격은 다른 digest 여야 한다 — 같으면 한 시도를 남의 자격으로 이어받을 수 있다. */
    @Test
    void computesADifferentDigestForADifferentCredential() throws Exception {
        mockMvc.perform(login(APPLE_BODY, ATTEMPT)).andExpect(status().isCreated());
        mockMvc.perform(login(OTHER_BODY, UUID.randomUUID().toString())).andExpect(status().isCreated());

        var lookups = DATA.receivedFor(DATA_LOOKUP);
        assertThat(field(lookups.get(0).body(), "credentialDigest"))
                .isNotEqualTo(field(lookups.get(1).body(), "credentialDigest"));
    }

    // ── DoD ③ 같은 키에 다른 본문은 409 다 ────────────────────────────────────────

    /**
     * field 가 범용 {@code Idempotency-Key} 가 «아니라» {@code X-Login-Attempt-Id} 여야 한다
     * (LLD §3 「반환 field 는 범용 키가 아니라 X-Login-Attempt-Id 다」). 앱이 그 이름을 보고 어느
     * 키를 새로 만들지 정하므로, 틀리면 복구가 엉뚱한 키를 바꾼다.
     */
    @Test
    void rejectsTheSameAttemptIdWithADifferentCredential() throws Exception {
        mockMvc.perform(login(APPLE_BODY)).andExpect(status().isCreated());

        mockMvc.perform(login(OTHER_BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("IDEMPOTENCY_KEY_REUSED"))
                .andExpect(jsonPath("$.error.field").value("X-Login-Attempt-Id"))
                .andExpect(jsonPath("$.error.retryable").value(false))
                .andExpect(jsonPath("$.data").doesNotExist());

        // 거절된 요청이 교환을 «부르지 않았다». 불렀다면 일회용 code 하나가 헛되이 소비된다.
        assertThat(DATA.hits(DATA_EXECUTE)).isEqualTo(1);
    }

    /** PENDING 인 동안(결과가 아직 없다) 다른 자격이 와도 같은 409 다 — 확정 전후가 같은 규칙이다. */
    @Test
    void rejectsADifferentCredentialWhileTheAttemptIsStillPending() throws Exception {
        // 조회는 「결과 없음」인데 교환 표면이 이미 그 키를 다른 자격으로 선점한 상태를 만든다.
        digests.put(ATTEMPT, "digest-of-some-other-credential");

        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("IDEMPOTENCY_KEY_REUSED"))
                .andExpect(jsonPath("$.error.field").value("X-Login-Attempt-Id"));
        assertThat(DATA.hits(DATA_EXECUTE)).as("digest 가 어긋나면 교환까지 가지 않는다").isZero();
    }

    /** 같은 자격인데 다른 실행자가 진행 중이면 409 지만 <b>재시도 가능</b>하고 Retry-After 가 붙는다. */
    @Test
    void reportsConcurrentExecutionAsRetryable() throws Exception {
        DATA.on(DATA_LOOKUP, request -> error(409, "LOGIN_ATTEMPT_IN_PROGRESS"));
        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REQUEST_IN_PROGRESS"))
                .andExpect(jsonPath("$.error.retryable").value(true))
                .andExpect(header().string("Retry-After", "1"));
    }

    /** 복구 창 종료·폐기·digest 키 교체는 <b>409 가 아니라</b> 401 이다 (LLD §3 이 그 오판을 금지한다). */
    @Test
    void reportsUnusableAttemptAsUnauthorizedNotKeyReuse() throws Exception {
        DATA.on(DATA_LOOKUP, request -> error(401, "LOGIN_ATTEMPT_UNUSABLE"));
        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    // ── DoD ④ AT 없는 최초 로그인이 필터에 막히지 않는다 ───────────────────────────

    /**
     * AT 가 <b>없어야</b> 통과한다 — 최초 로그인에는 우리 AT 가 없기 때문이다.
     *
     * <p>단언을 「201 이다」로만 두면 약하다: 필터가 막았어도 401 이고 컨트롤러가 거절해도 401 이라
     * 구분되지 않는다. 그래서 <b>요청이 상류까지 갔는지</b>를 함께 본다 — 상류 호출은 컨트롤러를
     * 지나야만 일어나므로, 그 사실이 「필터를 통과했다」의 증거다.
     */
    @Test
    void reachesTheControllerWithoutAnAccessToken() throws Exception {
        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.accessToken").exists());
        assertThat(DATA.hits(DATA_LOOKUP)).as("컨트롤러에 닿아야만 상류가 불린다").isEqualTo(1);
    }

    /**
     * 필터를 «푼» 것이 아니라 «좁힌» 것임을 고정한다.
     *
     * <p>AT 를 실었는데 그게 무효라면 401 이어야 한다 — LLD §2.1 「잘못된 AT 를 익명 로그인으로
     * 조용히 강등하지 않는다」. 여기서 통과시키면 폐기된 게스트의 AT 를 든 요청이 새 계정으로
     * 지나가고, 상류는 불리지도 않아야 한다.
     */
    @ParameterizedTest
    @CsvSource({"expired", "otherKey", "refreshType", "noSubject"})
    void stillRejectsAnInvalidAccessTokenOnTheLoginPath(String kind) throws Exception {
        String token = switch (kind) {
            case "expired" -> Tokens.expired(USER);
            case "otherKey" -> Tokens.signedWithOtherKey(USER);
            case "refreshType" -> Tokens.refresh(USER);
            default -> Tokens.withoutSubject();
        };
        mockMvc.perform(login(APPLE_BODY).header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        assertThat(DATA.hits(DATA_LOOKUP)).as("무효 AT 는 상류에 닿지 않는다").isZero();
    }

    /**
     * 서명은 유효하지만 <b>세션이 폐기된</b> AT 는 승격 자격이 아니다 (LLD §2.1 「세션 폐기 관문」).
     *
     * <p>Business 는 서명·만료까지만 볼 수 있다 — 로그아웃 여부는 Data 의 세션 원장에만 있다. 그래서
     * Data 가 403 {@code SESSION_NOT_ACTIVE} 로 거절하면 공개 401 로 낸다. 502 로 새면 앱이 재인증
     * 대신 재시도를 하고, 403 을 그대로 내면 공개 계약에 없는 상태가 나간다.
     */
    @Test
    void rejectsAnOptionalAccessTokenWhoseSessionWasRevoked() throws Exception {
        DATA.on(DATA_EXECUTE, request -> error(403, "SESSION_NOT_ACTIVE"));
        String token = Tokens.accessWithSession(USER, 3, SESSION);
        mockMvc.perform(login(APPLE_BODY).header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    /** 유효한 AT 는 계정 전환·게스트 승격의 근거라 «그대로» 상류로 전달돼야 한다 (LLD §2.1 · 정책 A04). */
    @Test
    void forwardsAValidOptionalAccessTokenToTheExchange() throws Exception {
        String token = Tokens.accessWithSession(USER, 3, SESSION);
        mockMvc.perform(login(APPLE_BODY).header("Authorization", "Bearer " + token))
                .andExpect(status().isCreated());
        assertThat(DATA.receivedFor(DATA_EXECUTE).get(0).body()).contains(token);
    }

    // ── 요청 형식 ────────────────────────────────────────────────────────────────

    /** 시도 ID 는 필수이고 하이픈 포함 36자여야 한다. 없으면 어떤 재시도도 같은 시도로 묶이지 않는다. */
    @ParameterizedTest
    @CsvSource({"''", "not-a-uuid", "1-2-3-4-5", "cccccccc-0000-7000-8000-00000000190",
        "cccccccc000070008000000000001908"})
    void rejectsAMalformedOrMissingAttemptId(String attemptId) throws Exception {
        mockMvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).content(APPLE_BODY)
                        .header("X-Login-Attempt-Id", attemptId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("X-Login-Attempt-Id"));
        assertThat(DATA.hits(DATA_LOOKUP)).isZero();
    }

    /**
     * 버전 비트로 거부하지 «않는다» (정책 A19: v4/v7 은 생성 «권고»다).
     *
     * <p>거부하면 다른 UUID 구현을 쓰는 앱 빌드가 통째로 로그인하지 못한다.
     */
    @ParameterizedTest
    @ValueSource(strings = {
        "cccccccc-0000-1000-8000-000000001908",
        "cccccccc-0000-4000-8000-000000001908",
        "cccccccc-0000-8000-8000-000000001908",
        // 대문자 표기도 같은 UUID 다 — UUID.fromString 이 정규화하고 우리는 «파싱한 값» 을
        // 상류로 보내므로 두 표기가 서로 다른 시도로 갈릴 여지가 없다. 거절하면 대문자로 찍는
        // 클라이언트가 통째로 로그인하지 못한다.
        "CCCCCCCC-0000-7000-8000-000000001908",
    })
    void acceptsAnyUuidVersionForTheAttemptId(String attemptId) throws Exception {
        mockMvc.perform(login(APPLE_BODY, attemptId)).andExpect(status().isCreated());
    }

    /** 대·소문자 표기가 «같은 시도» 로 묶여야 한다 — 갈리면 재시도가 새 로그인이 된다. */
    @Test
    void treatsUpperAndLowerCaseAttemptIdAsTheSameAttempt() throws Exception {
        mockMvc.perform(login(APPLE_BODY, ATTEMPT)).andExpect(status().isCreated());
        mockMvc.perform(login(APPLE_BODY, ATTEMPT.toUpperCase(java.util.Locale.ROOT)))
                .andExpect(status().isCreated());
        assertThat(DATA.hits(DATA_EXECUTE)).isEqualTo(1);
    }

    /** 알 수 없는 필드를 무시하면 오타 난 요청이 «성공» 한다 (LLD §1). */
    @Test
    void rejectsUnknownBodyFields() throws Exception {
        mockMvc.perform(login("""
                {"provider":"apple","credential":{"type":"id_token","value":"t"},\
                "termsVersion":"2026-09","isNewUser":true}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("isNewUser"));
    }

    /** 집합 밖 provider 는 400 UNSUPPORTED_PROVIDER 다 — 형식 오류(INVALID_REQUEST)와 가른다. */
    @ParameterizedTest
    @CsvSource({"naver", "APPLE", "Apple"})
    void rejectsProvidersOutsideTheSupportedSet(String provider) throws Exception {
        mockMvc.perform(login("""
                {"provider":"%s","credential":{"type":"id_token","value":"t"},"termsVersion":"2026-09"}"""
                .formatted(provider)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UNSUPPORTED_PROVIDER"))
                .andExpect(jsonPath("$.error.field").value("provider"));
    }

    /** 알려진 provider 의 «지원하지 않는» 자격 종류는 422 다 — 400 UNSUPPORTED_PROVIDER 와 가른다(정책 A18). */
    @Test
    void rejectsAnUnsupportedCredentialKindForAKnownProvider() throws Exception {
        mockMvc.perform(login("""
                {"provider":"apple","credential":{"type":"access_token","value":"t"},\
                "termsVersion":"2026-09"}"""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("credential.type"));
    }

    /**
     * {@code authorizationCode} 는 아직 422 다 — 실제 교환 어댑터가 없다.
     *
     * <p>LLD §2.1: 「code 를 기존 JWT 검증 함수의 token 인자에 넣는 것은 구현이 아니다」. 넣으면
     * 검증을 통과한 «척» 하는 경로가 생긴다. 어댑터가 붙기 전까지 명시적으로 거절한다.
     */
    @Test
    void rejectsAuthorizationCodeUntilAnExchangeAdapterExists() throws Exception {
        mockMvc.perform(login("""
                {"provider":"apple","authorizationCode":"provider-code","termsVersion":"2026-09"}"""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("authorizationCode"));
        assertThat(DATA.hits(DATA_EXECUTE)).isZero();
    }

    /** 두 자격을 동시에 내거나 하나도 내지 않으면 400 이다 (LLD §2.1 「정확히 하나」). */
    @ParameterizedTest
    @ValueSource(strings = {
        "{\"provider\":\"apple\",\"termsVersion\":\"2026-09\"}",
        "{\"provider\":\"apple\",\"authorizationCode\":\"c\","
                + "\"credential\":{\"type\":\"id_token\",\"value\":\"t\"},\"termsVersion\":\"2026-09\"}",
    })
    void requiresExactlyOneCredentialForm(String body) throws Exception {
        mockMvc.perform(login(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("credential"));
    }

    /** {@code termsVersion} 은 필수다 — 없으면 무엇에 동의했는지 원장에 남지 않는다. */
    @Test
    void requiresTermsVersion() throws Exception {
        mockMvc.perform(login("""
                {"provider":"apple","credential":{"type":"id_token","value":"t"}}"""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("termsVersion"));
    }

    // ── 제공자 자격 실패는 제공자별 401 로 보존된다 (LLD §2.1 · 정책 A18) ───────────

    /**
     * 잘못된 소셜 토큰은 <b>401 {@code *_TOKEN}</b> 이지 502 가 아니다.
     *
     * <p>Business 는 상류 401 을 기본적으로 「서비스 자격 거부」(502)로 읽는다. 로그인 경로를
     * 등록하지 않으면 <b>가장 흔한 로그인 실패가 서버 장애처럼 보인다</b> — 앱은 재인증 대신
     * 재시도를 하고, 대시보드에는 5xx 가 쌓인다.
     */
    @ParameterizedTest
    @CsvSource({"apple,APPLE_TOKEN", "google,GOOGLE_TOKEN", "kakao,KAKAO_TOKEN",
        "line,LINE_TOKEN", "instagram,INSTAGRAM_TOKEN", "facebook,FACEBOOK_TOKEN"})
    void preservesPerProviderCredentialFailures(String provider, String code) throws Exception {
        DATA.on(DATA_EXECUTE, request -> error(401, code));
        String kind = switch (provider) {
            case "apple", "google", "facebook" -> "id_token";
            default -> "access_token";
        };
        mockMvc.perform(login("""
                {"provider":"%s","credential":{"type":"%s","value":"bad"},"termsVersion":"2026-09"}"""
                .formatted(provider, kind)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value(code));
    }

    /** 코드 없는 상류 401 은 서비스 자격 거부다 — 사용자 로그아웃을 유도하지 않는다(502). */
    @Test
    void treatsCodelessUpstream401AsServiceCredentialRejection() throws Exception {
        DATA.on(DATA_EXECUTE, request -> new MockUpstream.Response(401, "{\"error\":\"denied\"}"));
        mockMvc.perform(login(APPLE_BODY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_AUTH_FAILED"));
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private MockHttpServletRequestBuilder login(String body) {
        return login(body, ATTEMPT);
    }

    private MockHttpServletRequestBuilder login(String body, String attemptId) {
        return post(PATH).contentType(MediaType.APPLICATION_JSON).content(body)
                .header("X-Login-Attempt-Id", attemptId);
    }

    private static String session(String accessToken, String refreshToken) {
        return "{\"accessToken\":\"" + accessToken + "\",\"refreshToken\":\"" + refreshToken
                + "\",\"userId\":\"" + USER + "\",\"onboardingComplete\":false}";
    }

    /** 평평한 JSON 본문에서 문자열 필드 하나를 꺼낸다 — mock 상류가 판정에 쓸 최소한의 파싱. */
    private static String field(String body, String name) {
        String marker = "\"" + name + "\":\"";
        int start = body.indexOf(marker);
        if (start < 0) {
            return null;
        }
        start += marker.length();
        return body.substring(start, body.indexOf('"', start));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
