package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.analytics.exception.AnalyticsErrorCode;
import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
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
            Map.entry(CurrencyErrorCode.class, c -> new CurrencyException((CurrencyErrorCode) c)),
            Map.entry(FocusErrorCode.class, c -> new FocusException((FocusErrorCode) c)),
            Map.entry(FriendErrorCode.class, c -> new FriendException((FriendErrorCode) c)),
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
        assertThat(found).as("실측 기준 도메인 enum 12개 + CommonErrorCode — outbox 가 GROMO-1659·1660 공통 기반에서 늘었다")
                .hasSize(13);
    }

    @TestFactory
    @DisplayName("상수 130개 전부 — (status, code=name(), message) 가 enum 에 적힌 그대로 나간다")
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
        assertThat(tests).as("실측 기준 도메인 상수 114개 + 공통 15개 — 2026-09-11 재측정")
                .hasSize(130);
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
