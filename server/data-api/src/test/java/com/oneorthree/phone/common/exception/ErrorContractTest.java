package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.analytics.exception.AnalyticsErrorCode;
import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.currency.exception.CurrencyErrorCode;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.group.exception.ChallengeResultClaimHeldException;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.letter.exception.LetterErrorCode;
import com.oneorthree.phone.letter.exception.LetterException;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 에러 응답 계약을 상수 단위로 고정한다 (GROMO-1657).
 *
 * <p><b>무엇을 지키는가.</b> 앱은 {@code body.code} 문자열로 분기한다. 그래서 계약은 봉투 모양이
 * 아니라 <b>「이 상수는 이 상태·이 code·이 문구로 나간다」</b>라는 105개의 개별 사실이다. 종전엔
 * 그 사실을 지키는 테스트가 낙관락 1건뿐이었고, 도메인 핸들러 11개는 직접 테스트가 없었다 —
 * 핸들러 하나가 {@code e.getMessage()} 대신 다른 것을 실어도 아무것도 빨개지지 않았다.
 *
 * <p><b>어떻게 지키는가.</b> {@code ErrorCode} 를 구현한 enum 을 <b>클래스패스에서 찾아</b>
 * 상수마다 예외를 만들어 단일 핸들러에 통과시키고 {@code (status, code, message)} 를 단언한다.
 * 목록을 손으로 적지 않는 이유는, 손으로 적으면 새 도메인이 빠져도 초록이기 때문이다 —
 * 찾은 enum 이 예외 팩토리 표에 없으면 그것 자체가 실패다.
 *
 * <p>여기서 잡히는 회귀: 핸들러가 {@code code.name()} 이 아닌 다른 것을 code 로 싣는 것,
 * 상태를 잘못 꺼내는 것, enum 이 {@code ErrorCode} 구현을 빠뜨리는 것, 예외가
 * {@code DomainException} 을 빠뜨려 핸들러를 못 타는 것, 도메인별 핸들러가 다시 생기는 것.
 */
class ErrorContractTest {

    private static final String ROOT = "com.oneorthree.phone";

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    /**
     * 도메인 enum → 그 도메인 예외를 만드는 팩토리. <b>ErrorCode 구현체가 새로 생기면 여기 한 줄을
     * 더해야 한다</b> — 빠지면 {@link #everyErrorCodeEnumHasAFactory} 가 이름을 지목하며 실패한다.
     */
    private static final Map<Class<? extends ErrorCode>, Function<ErrorCode, DomainException>> FACTORIES = Map.ofEntries(
            Map.entry(AnalyticsErrorCode.class, c -> new AnalyticsException((AnalyticsErrorCode) c)),
            Map.entry(AuthErrorCode.class, c -> new AuthException((AuthErrorCode) c)),
            Map.entry(InvalidTokenErrorCode.class, c -> new InvalidTokenException((InvalidTokenErrorCode) c)),
            Map.entry(ConstructionErrorCode.class, c -> new ConstructionException((ConstructionErrorCode) c)),
            Map.entry(CurrencyErrorCode.class, c -> new CurrencyException((CurrencyErrorCode) c)),
            Map.entry(FocusErrorCode.class, c -> new FocusException((FocusErrorCode) c)),
            Map.entry(FriendErrorCode.class, c -> new FriendException((FriendErrorCode) c)),
            Map.entry(LetterErrorCode.class, c -> new LetterException((LetterErrorCode) c)),
            Map.entry(GroupErrorCode.class, c -> new GroupException((GroupErrorCode) c)),
            Map.entry(InviteLinkErrorCode.class, c -> new InviteLinkException((InviteLinkErrorCode) c)),
            Map.entry(LeagueErrorCode.class, c -> new LeagueException((LeagueErrorCode) c)),
            Map.entry(OutboxErrorCode.class, c -> new OutboxException((OutboxErrorCode) c)),
            Map.entry(StatsErrorCode.class, c -> new StatsException((StatsErrorCode) c)),
            Map.entry(UserErrorCode.class, c -> new UserException((UserErrorCode) c)),
            // 공통 코드는 프레임워크 예외 핸들러가 직접 봉투에 싣는다 — 도메인 예외로 던져지진 않지만
            // 같은 (status, name, message) 규칙을 지켜야 하므로 익명 DomainException 으로 같은 경로를 태운다
            Map.entry(CommonErrorCode.class, c -> new DomainException(c) {
                @Override
                public ErrorCode getErrorCode() {
                    return c;
                }
            }));

    private static JavaClasses production() {
        return new ClassFileImporter()
                .withImportOption(new ImportOption.DoNotIncludeTests())
                .importPackages(ROOT);
    }

    /** 클래스패스에서 {@link ErrorCode} 를 구현한 enum 전부. 손으로 적은 목록이 아니다. */
    private static List<Class<? extends ErrorCode>> errorCodeEnums() {
        List<Class<? extends ErrorCode>> found = new ArrayList<>();
        for (JavaClass javaClass : production()) {
            if (javaClass.isEnum() && javaClass.isAssignableTo(ErrorCode.class)) {
                found.add(javaClass.reflect().asSubclass(ErrorCode.class));
            }
        }
        found.sort((a, b) -> a.getName().compareTo(b.getName()));
        return found;
    }

    @Test
    @DisplayName("ErrorCode 를 구현한 enum 마다 예외 팩토리가 있다 — 새 도메인이 빠지면 여기서 이름이 뜬다")
    void everyErrorCodeEnumHasAFactory() {
        Set<String> found = errorCodeEnums().stream().map(Class::getSimpleName).collect(Collectors.toCollection(TreeSet::new));
        Set<String> known = FACTORIES.keySet().stream().map(Class::getSimpleName).collect(Collectors.toCollection(TreeSet::new));

        assertThat(found).as("ErrorCode 구현 enum 이 클래스패스에 있는데 FACTORIES 에 없다").isEqualTo(known);
        assertThat(found).as("실측 기준 도메인 enum 14개 + CommonErrorCode — letter(GROMO-1933)·construction(GROMO-1767)이 늘었다")
                .hasSize(15);
    }

    @TestFactory
    @DisplayName("상수 171개 전부 — (status, code=name(), message) 가 enum 에 적힌 그대로 나간다")
    List<DynamicTest> everyConstantGoesOutExactlyAsDeclared() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Class<? extends ErrorCode> enumClass : errorCodeEnums()) {
            Function<ErrorCode, DomainException> factory = FACTORIES.get(enumClass);
            for (ErrorCode code : enumClass.getEnumConstants()) {
                tests.add(DynamicTest.dynamicTest(enumClass.getSimpleName() + "." + code.name(), () -> {
                    ResponseEntity<ErrorResponse> response = handler.handleDomain(factory.apply(code));

                    assertThat(response.getStatusCode()).as("status").isEqualTo(code.getStatus());
                    assertThat(response.getBody()).isNotNull();
                    assertThat(response.getBody().getCode()).as("code 는 상수 이름 그대로").isEqualTo(code.name());
                    assertThat(response.getBody().getMessage()).as("message 는 enum 문구 그대로").isEqualTo(code.getMessage());
                }));
            }
        }
        // GROMO-1660 이 초대 자격·이관 판정 코드를 2개 더 늘렸다(CLAIM_INTENT_NOT_FOUND ·
        // CLAIM_INTENT_LEASE_STALE) — 재개 실행자의 「없는 항목」과 「낡은 리스」를 한 코드로 접으면
        // 정상 경합과 배선 사고가 구분되지 않는다.
        // GROMO-1764 가 집중 세션 수명주기 상수 12개를 더했다 — 입력 검증 5(INVALID_SUBJECT ·
        // INVALID_TARGET_MINUTES · INVALID_SUMMARY_DATE · SUMMARY_DATE_OUT_OF_RANGE ·
        // INVALID_SUMMARY_TIMEZONE), 전제 판정 3(ISLAND_NOT_CURRENT · ISLAND_MEMBERSHIP_REQUIRED ·
        // SESSION_IN_PROGRESS), 전이 2(EXPECTED_VERSION_REQUIRED · SESSION_STATE_CONFLICT),
        // 그리고 게이트 2(REWARD_POLICY_UNAVAILABLE · SESSION_START_UNAVAILABLE) — 같은 503 이지만
        // 막는 사유가 달라 하나만 먼저 여는 날 구분이 필요하다.
        // GROMO-1908 이 로그인 시도 원장 상수 2개를 더했다(AuthErrorCode) —
        // LOGIN_ATTEMPT_IN_PROGRESS(409: 같은 자격인데 다른 실행자가 진행 중) 와
        // LOGIN_ATTEMPT_UNUSABLE(401: 복구 창 종료·폐기·digest 키 교체). 앞의 것을
        // IDEMPOTENCY_KEY_CONFLICT(같은 키에 «다른» 자격)와 합치면 앱이 「키를 잘못 썼다」로 읽고
        // 새 시도를 만들어, 막으려던 동시 code 교환이 그대로 생긴다. 뒤의 것을 그 409 로 판정하는
        // 것은 계정 LLD §3 이 명시적으로 금지한다 — 정상 사용자가 배포 한 번에 막히기 때문이다.
        // GROMO-1759 가 섬 검색 진입 가드 1개를 더했다(GroupErrorCode.OBSERVATORY_LOCKED) —
        // 전망대 없이 이름 검색을 여는 403 은 첫 소속 탐색(가드 없는 discover)과 갈라야 한다.
        // GROMO-1894 가 친구 요청 취소의 권한 코드 1개(NOT_REQUEST_SENDER)를 더했다 — 발신자 축 거부를
        // 수신자 축(NOT_REQUEST_RECEIVER)과 한 코드로 접으면 앱이 「내가 보낸 요청이 아니다」를 구분하지 못한다.
        // GROMO-1775 가 우체통 시설 잠금 코드 1개를 더했다(GroupErrorCode.MAILBOX_LOCKED) —
        // 전망대 가드와 같은 결이지만 잠기는 시설이 달라 한 코드로 접지 않는다.
        // GROMO-1933 이 편지 코드 9개를 더했다 — 입력 4(SELF_LETTER · LETTER_CONTENT_BLANK ·
        // INVALID_PAGE_REQUEST · INVALID_MAILBOX_TYPE), 권한 2(LETTER_MAILBOX_LOCKED ·
        // NOT_LETTER_PARTICIPANT), 대상 없음 2(LETTER_NOT_FOUND · LETTER_RECIPIENT_NOT_FRIEND),
        // 본문 상한 1(LETTER_CONTENT_OUT_OF_RANGE).
        // GROMO-1767 이 건설 코드 6개를 더했다(ConstructionErrorCode) — 권한·시설 잠금
        // 2(CONSTRUCTION_FORBIDDEN · FACILITY_LOCKED), 입력 1(OUT_OF_RANGE), 충돌
        // 3(VERSION_CONFLICT · STATE_CONFLICT · INSUFFICIENT_FUNDS) — 섬 건설 명령의 실패 축이다.
        // GROMO-1929 가 legacy 선택 AT 관문 상수 2개를 더했다 — ACCESS_TOKEN(401: Bearer 형식·
        // 서명·만료·타입 거절, InvalidTokenErrorCode)과 LEGACY_SESSION_NOT_ACTIVE(401: 폐기·
        // 세대 불일치·sid 없음, AuthErrorCode). 후자는 내부 경로의 SESSION_NOT_ACTIVE(403)와 같은
        // 판정이지만 legacy 경로는 Business 매핑 없이 앱에 직접 닿아 공개 401 이어야 한다.
        // GROMO-1801 이 신규 PATCH /me 게이트 1개를 더했다(UserErrorCode.PROFILE_UPDATE_UNAVAILABLE) —
        // 집중 세션 게이트와 같은 503 이지만 여는 조건(온보딩 전이 사건 연결)이 달라 코드를 가른다.
        assertThat(tests).as("실측 기준 도메인 상수 156개 + 공통 15개 — 집중 세션 12종·로그인 원장 2종·전망대 가드·친구 취소·우체통 잠금·편지 9종·건설 6종·legacy AT 관문 2종·계정 PATCH 게이트 포함")
                .hasSize(171);
        return tests;
    }

    @Test
    @DisplayName("재시도 하위 타입은 상대 지연을 얹은 봉투로 나가되 code·status 는 부모 규칙 그대로다")
    void retryAfterSubtypeKeepsParentContractAndAddsDelay() {
        ResponseEntity<RetryAfterErrorResponse> response =
                handler.handleChallengeResultClaimHeld(new ChallengeResultClaimHeldException(1500L));

        assertThat(response.getStatusCode()).isEqualTo(GroupErrorCode.RESULT_CLAIM_HELD.getStatus());
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo("RESULT_CLAIM_HELD");
        assertThat(response.getBody().getMessage()).isEqualTo(GroupErrorCode.RESULT_CLAIM_HELD.getMessage());
        assertThat(response.getBody().getRetryAfterMs()).isEqualTo(1500L);
    }

    @Test
    @DisplayName("도메인별 핸들러가 다시 생기지 않는다 — DomainException 을 잡는 핸들러는 하나뿐이다")
    void onlyOneHandlerCatchesDomainExceptions() {
        List<String> domainHandlers = new ArrayList<>();
        for (Method m : GlobalExceptionHandler.class.getDeclaredMethods()) {
            ExceptionHandler ann = m.getAnnotation(ExceptionHandler.class);
            if (ann == null) {
                continue;
            }
            for (Class<? extends Throwable> t : ann.value()) {
                // 재시도 하위 타입은 봉투 모양이 달라 전용 핸들러가 정당하다 — 그것 하나만 예외
                if (DomainException.class.isAssignableFrom(t) && t != ChallengeResultClaimHeldException.class) {
                    domainHandlers.add(m.getName() + "(" + t.getSimpleName() + ")");
                }
            }
        }
        assertThat(domainHandlers)
                .as("도메인 예외를 잡는 핸들러는 handleDomain(DomainException) 하나여야 한다")
                .containsExactly("handleDomain(DomainException)");
    }
}
