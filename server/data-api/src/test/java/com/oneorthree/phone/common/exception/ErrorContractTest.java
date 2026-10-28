package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.appearance.exception.AppearanceErrorCode;
import com.oneorthree.phone.appearance.exception.AppearanceException;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.letter.exception.LetterErrorCode;
import com.oneorthree.phone.letter.exception.LetterException;
import com.oneorthree.phone.magazine.exception.MagazineErrorCode;
import com.oneorthree.phone.magazine.exception.MagazineException;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.quest.exception.QuestErrorCode;
import com.oneorthree.phone.quest.exception.QuestException;
import com.oneorthree.phone.shop.exception.ShopErrorCode;
import com.oneorthree.phone.shop.exception.ShopException;
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
            Map.entry(AppearanceErrorCode.class, c -> new AppearanceException((AppearanceErrorCode) c)),
            Map.entry(AuthErrorCode.class, c -> new AuthException((AuthErrorCode) c)),
            Map.entry(InvalidTokenErrorCode.class, c -> new InvalidTokenException((InvalidTokenErrorCode) c)),
            Map.entry(ConstructionErrorCode.class, c -> new ConstructionException((ConstructionErrorCode) c)),
            Map.entry(FocusErrorCode.class, c -> new FocusException((FocusErrorCode) c)),
            Map.entry(FriendErrorCode.class, c -> new FriendException((FriendErrorCode) c)),
            Map.entry(LetterErrorCode.class, c -> new LetterException((LetterErrorCode) c)),
            Map.entry(GroupErrorCode.class, c -> new GroupException((GroupErrorCode) c)),
            Map.entry(InviteLinkErrorCode.class, c -> new InviteLinkException((InviteLinkErrorCode) c)),
            Map.entry(MagazineErrorCode.class, c -> new MagazineException((MagazineErrorCode) c)),
            Map.entry(OutboxErrorCode.class, c -> new OutboxException((OutboxErrorCode) c)),
            Map.entry(QuestErrorCode.class, c -> new QuestException((QuestErrorCode) c)),
            Map.entry(ShopErrorCode.class, c -> new ShopException((ShopErrorCode) c)),
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
        assertThat(found).isNotEmpty();
    }

    @TestFactory
    @DisplayName("모든 오류 코드 — (status, code=name(), message) 가 enum 에 적힌 그대로 나간다")
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
        assertThat(tests).as("오류 코드 스캔은 비어 있지 않아야 한다").isNotEmpty();
        return tests;
    }


    @Test
    @DisplayName("계정 레이트리밋은 429 RATE_LIMITED 에 상대 지연(ms)과 올림한 Retry-After(초)를 싣는다")
    void rateLimitedCarriesDelayInBodyAndHeader() {
        ResponseEntity<RetryAfterErrorResponse> response = handler.handleRateLimited(new RateLimitedException(1500L));

        assertThat(response.getStatusCode().value()).isEqualTo(429);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo("RATE_LIMITED");
        assertThat(response.getBody().getMessage()).isEqualTo(CommonErrorCode.RATE_LIMITED.getMessage());
        assertThat(response.getBody().getRetryAfterMs()).isEqualTo(1500L);
        // 1.5초 → 2초. 내림하면 1초 뒤 재시도가 아직 닫힌 창에 부딪힌다.
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("2");
    }

}
