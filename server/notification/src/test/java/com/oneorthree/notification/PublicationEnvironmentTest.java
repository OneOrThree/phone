package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class PublicationEnvironmentTest {
    @Test
    void dev프로파일로_prod_DB에_연결하면_발송_명령은_실행되지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var publications = mock(PublicationService.class);
        var controller = new PublicationController(publications,
                new NotificationEnvironmentGuard(environment, jdbc, "gromo-dev"));

        assertThatThrownBy(() -> controller.publish(UUID.randomUUID(), Map.of(), "key", null))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB/FCM 환경");
        verifyNoInteractions(publications);
    }

    @Test
    void FCM_프로젝트_요청이_다르면_발송_명령은_실행되지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("dev"));
        when(jdbc.queryForList(argThat(sql -> sql.contains("gromo.fcm_project_id")), eq(String.class)))
                .thenReturn(List.of("gromo-dev"));
        var publications = mock(PublicationService.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("dev");
        when(request.getHeader("X-Backoffice-Fcm-Project")).thenReturn("gromo-prod");
        var controller = new PublicationController(publications,
                new NotificationEnvironmentGuard(environment, jdbc, "gromo-dev"));

        assertThatThrownBy(() -> controller.publish(UUID.randomUUID(), Map.of(), "key", request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("요청 환경");
        verifyNoInteractions(publications);
    }

    @Test
    void 백오피스와_Notification이_함께_운영_FCM을_가리켜도_DB_표식과_다르면_발송하지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("dev"));
        when(jdbc.queryForList(argThat(sql -> sql.contains("gromo.fcm_project_id")), eq(String.class)))
                .thenReturn(List.of("gromo-dev"));
        var publications = mock(PublicationService.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("dev");
        when(request.getHeader("X-Backoffice-Fcm-Project")).thenReturn("gromo-prod");
        var controller = new PublicationController(publications,
                new NotificationEnvironmentGuard(environment, jdbc, "gromo-prod"));

        assertThatThrownBy(() -> controller.publish(UUID.randomUUID(), Map.of(), "key", request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB/FCM 환경");
        verifyNoInteractions(publications);
    }
}
