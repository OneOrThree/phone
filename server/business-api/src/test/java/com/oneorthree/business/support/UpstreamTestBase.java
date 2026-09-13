package com.oneorthree.business.support;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 계약 테스트의 공통 바탕 — <b>실제 필터 체인 + 실제 컨트롤러 + 실제 클라이언트</b>를 띄우고
 * 상류만 {@link MockUpstream}(진짜 HTTP 서버)으로 바꾼다.
 *
 * <p>{@code @AutoConfigureMockMvc} 가 필요한 이유: Boot 4 는 MVC 테스트 오토컨피그가 별도 스타터고,
 * 이게 있어야 {@code FilterRegistrationBean} 으로 등록한 {@code AccessTokenFilter} 까지 포함한
 * 필터 체인으로 조립된다. 컨트롤러만 단독으로 띄우면 이 서비스의 보안 경계가 테스트에서 통째로 빠진다.
 *
 * <p>상류 셋을 <b>각각 다른 포트</b>로 띄운다 — 한 서버로 합치면 「caller 별 토큰이 명시된 대상에만
 * 가는가」(A22 ㊀)를 확인할 수 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
public abstract class UpstreamTestBase {

    protected static final MockUpstream DATA = MockUpstream.start();
    protected static final MockUpstream NOTI = MockUpstream.start();
    protected static final MockUpstream LINK = MockUpstream.start();

    @Autowired
    protected MockMvc mockMvc;

    @DynamicPropertySource
    static void upstreams(DynamicPropertyRegistry registry) {
        registry.add("business.upstream.data.base-url", DATA::baseUrl);
        registry.add("business.upstream.notification.base-url", NOTI::baseUrl);
        registry.add("business.upstream.link.base-url", LINK::baseUrl);
    }

    @BeforeEach
    void resetUpstreams() {
        DATA.reset();
        NOTI.reset();
        LINK.reset();
    }

    // ⚠️ @AfterAll 로 서버를 닫지 «않는다». 이 클래스를 상속한 모든 테스트 클래스가 그 훅을 각자
    //    실행하므로, 첫 클래스가 끝나는 순간 공유 서버가 닫히고 이후 클래스는 전부 connection refused
    //    가 된다(클래스 단독 실행은 통과하는데 합쳐 돌리면 깨지는 형태로 나타난다). 서버 종료는
    //    MockUpstream 이 JVM 종료 훅으로 처리한다.

    /** 위성 쓰기 전 활성 검사를 통과시킨다(A22 ⓖ). 이걸 빼면 모든 쓰기가 401 로 막힌다. */
    protected static void stubActiveUser(java.util.UUID userId) {
        DATA.on("GET /internal/users/" + userId + "/activation",
                request -> new MockUpstream.Response(200, "{\"active\":true}"));
    }
}
