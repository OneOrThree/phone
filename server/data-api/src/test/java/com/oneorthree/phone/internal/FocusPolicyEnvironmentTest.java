package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.FocusPolicyAdminService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class FocusPolicyEnvironmentTest {
    @Test
    void 요청_환경과_운영_DB_표식이_다르면_정책을_발행하지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var policies = mock(FocusPolicyAdminService.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("dev");
        var controller = new InternalFocusPolicyAdminController(policies, environment, jdbc);

        assertThatThrownBy(() -> controller.publish(UUID.randomUUID(), null, request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("요청 환경");
        verifyNoInteractions(policies);
    }

    @Test
    void 실행_프로파일과_DB_표식이_다르면_정책_이력을_읽지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var policies = mock(FocusPolicyAdminService.class);
        var controller = new InternalFocusPolicyAdminController(policies, environment, jdbc);

        assertThatThrownBy(() -> controller.current(null))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB 환경");
        verifyNoInteractions(policies);
    }
}
