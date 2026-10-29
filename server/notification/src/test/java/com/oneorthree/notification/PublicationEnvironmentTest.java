package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

class PublicationEnvironmentTest {
    @Test
    void RDS_설명_표식이_프로파일과_FCM에_일치할_때만_발송_준비가_된다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of());
        when(jdbc.queryForObject(anyString(), eq(String.class)))
                .thenReturn("gromo.environment=prod;gromo.fcm_project_id=catus-prod");
        var guard = new NotificationEnvironmentGuard(environment, jdbc, "catus-prod");

        assertThat(guard.identity()).containsEntry("environment", "prod")
                .containsEntry("fcmProjectId", "catus-prod");
        var wrongProject = new NotificationEnvironmentGuard(environment, jdbc, "catus-dev");
        assertThatThrownBy(wrongProject::assertDispatchReady)
                .isInstanceOf(NotificationEnvironmentGuard.EnvironmentMismatch.class);
    }
    @Test
    void 운영_이력도_환경을_검증한_뒤_실제_원장을_읽는다() {
        var guard = mock(NotificationEnvironmentGuard.class);
        when(guard.identity()).thenReturn(Map.of("environment", "prod", "fcmProjectId", "gromo-prod"));
        var catalog = mock(AdminCatalog.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("prod");
        when(request.getHeader("X-Backoffice-Fcm-Project")).thenReturn("gromo-prod");
        when(request.getAttribute("notification.actor")).thenReturn("member-1");
        when(catalog.deliveries("member-1", "cursor", 50, null, null, null))
                .thenReturn(Map.of("items", List.of()));
        var controller = new PublicationController(mock(PublicationService.class), guard, catalog);

        assertThat(controller.history("cursor", 50, request)).containsKey("items");
        verify(catalog).deliveries("member-1", "cursor", 50, null, null, null);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("dev");
        assertThatThrownBy(() -> controller.history("cursor", 50, request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("요청 환경");
    }

    @Test
    void DB_표식_조회_실패도_환경_오류로_분류한다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        doThrow(new DataAccessResourceFailureException("DB unavailable"))
                .when(jdbc).queryForList(anyString(), eq(String.class));
        var guard = new NotificationEnvironmentGuard(environment, jdbc, "gromo-dev");

        assertThatThrownBy(guard::assertDispatchReady)
                .isInstanceOf(NotificationEnvironmentGuard.EnvironmentMismatch.class)
                .hasMessageContaining("환경 조회");
    }

    @Test
    void 프로파일이_없으면_대기_알림도_발송하지_않는다() {
        var guard = new NotificationEnvironmentGuard(new MockEnvironment(), mock(JdbcTemplate.class), "gromo-dev");

        assertThatThrownBy(guard::assertDispatchReady)
                .isInstanceOf(NotificationEnvironmentGuard.EnvironmentMismatch.class)
                .hasMessageContaining("환경 프로파일");
    }

    @Test
    void dev프로파일로_prod_DB에_연결하면_발송_명령은_실행되지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var publications = mock(PublicationService.class);
        var controller = new PublicationController(publications,
                new NotificationEnvironmentGuard(environment, jdbc, "gromo-dev"), mock(AdminCatalog.class));

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
                new NotificationEnvironmentGuard(environment, jdbc, "gromo-dev"), mock(AdminCatalog.class));

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
                new NotificationEnvironmentGuard(environment, jdbc, "gromo-prod"), mock(AdminCatalog.class));

        assertThatThrownBy(() -> controller.publish(UUID.randomUUID(), Map.of(), "key", request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB/FCM 환경");
        verifyNoInteractions(publications);
    }

    @Test
    void 환경_응답은_FCM_식별값을_보존하고_지원_API_계약을_추가한다() throws Exception {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        when(jdbc.queryForList(argThat(sql -> sql.contains("gromo.fcm_project_id")), eq(String.class)))
                .thenReturn(List.of("catus-prod"));
        var guard = new NotificationEnvironmentGuard(environment, jdbc, "catus-prod");
        var controller = new PublicationController(mock(PublicationService.class), guard, mock(AdminCatalog.class));
        var http = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        http.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                        "/internal/admin/publications/environment"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.environment").value("prod"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.fcmProjectId").value("catus-prod"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.contractVersion").value("1"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.capabilities").value(org.hamcrest.Matchers.contains("notification.publication.v1",
                                "notification.history.v1", "notification.templates.v1")));
        assertThat(guard.identity()).containsExactlyInAnyOrderEntriesOf(
                Map.of("environment", "prod", "fcmProjectId", "catus-prod"));
    }
}
