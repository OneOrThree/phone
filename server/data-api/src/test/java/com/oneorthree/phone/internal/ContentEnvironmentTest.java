package com.oneorthree.phone.internal;

import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.internal.service.ContentHistoryService;
import com.oneorthree.phone.internal.service.MagazineReviewService;
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

class ContentEnvironmentTest {
    @Test
    void RDS에서_데이터베이스_설명_표식을_검증한다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of());
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenReturn("gromo.environment=prod");
        var controller = new InternalContentAdminController(mock(DeveloperNoticeService.class),
                mock(ContentHistoryService.class), mock(MagazineReviewService.class),
                mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class), environment, jdbc);

        org.assertj.core.api.Assertions.assertThat(controller.environment().get("environment")).isEqualTo("prod");
        when(jdbc.queryForObject(anyString(), eq(String.class))).thenReturn("gromo.environment=dev");
        assertThatThrownBy(controller::environment).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Data DB 환경");
    }
    @Test
    void 다른_환경의_이력은_조회하지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var history = mock(ContentHistoryService.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("dev");
        var controller = new InternalContentAdminController(mock(DeveloperNoticeService.class), history,
                mock(MagazineReviewService.class), mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class), environment, jdbc);

        assertThatThrownBy(() -> controller.noticeHistory(null, 50, request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("요청 환경");
        verifyNoInteractions(history);
    }

    @Test
    void dev프로파일로_prod_DB에_연결하면_공지_게시는_실행되지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var notices = mock(DeveloperNoticeService.class);
        var controller = new InternalContentAdminController(notices, mock(ContentHistoryService.class), mock(MagazineReviewService.class),
                mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class),
                environment, jdbc);

        assertThatThrownBy(() -> controller.publishNotice(UUID.randomUUID(), null, null))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB 환경");
        verifyNoInteractions(notices);
    }

    @Test
    void 요청_환경이_실제_DB와_다르면_공지_게시는_실행되지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("dev"));
        var notices = mock(DeveloperNoticeService.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("prod");
        var controller = new InternalContentAdminController(notices, mock(ContentHistoryService.class), mock(MagazineReviewService.class),
                mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class),
                environment, jdbc);

        assertThatThrownBy(() -> controller.publishNotice(UUID.randomUUID(), null, request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("요청 환경");
        verifyNoInteractions(notices);
    }
    @Test
    void 건설_정책도_환경_불일치에서는_적용하지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("dev");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var policies = mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class);
        var controller = new InternalContentAdminController(mock(DeveloperNoticeService.class),
                mock(ContentHistoryService.class), mock(MagazineReviewService.class), policies, environment, jdbc);
        assertThatThrownBy(() -> controller.applyConstructionPolicy(UUID.randomUUID(), null, null))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB 환경");
        verifyNoInteractions(policies);
    }


    @Test
    void 환경_응답은_검증된_환경과_지원_API_계약을_함께_반환한다() throws Exception {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var controller = new InternalContentAdminController(mock(DeveloperNoticeService.class),
                mock(ContentHistoryService.class), mock(MagazineReviewService.class),
                mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class), environment, jdbc);
        var http = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        http.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                        "/internal/admin/content/environment"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.environment").value("prod"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.contractVersion").value("1"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.capabilities").value(org.hamcrest.Matchers.contains("content.publication.v1",
                                "content.history.v1", "content.notice.withdraw.v1",
                                    "content.app-requirements.v1",
                                "construction.policy.v1", "focus.policy.v1")));
    }

    private org.springframework.test.web.servlet.ResultActions environmentResponse(String obsVersion,
            boolean historyTable) throws Exception {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        if (obsVersion != null) {
            environment.setProperty("OBS_VERSION", obsVersion);
        }
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(historyTable);
        var controller = new InternalContentAdminController(mock(DeveloperNoticeService.class),
                mock(ContentHistoryService.class), mock(MagazineReviewService.class),
                mock(com.oneorthree.phone.internal.service.ConstructionPolicyAdminService.class), environment, jdbc);
        return org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build()
                .perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                        "/internal/admin/content/environment"));
    }

    @Test
    void OBS_VERSION이_있으면_서버_버전으로_반환한다() throws Exception {
        environmentResponse(" abc123 ", true)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.serverVersion").value("abc123"));
    }

    @Test
    void OBS_VERSION이_없거나_비어_있으면_unknown이다() throws Exception {
        environmentResponse(null, true).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                .jsonPath("$.serverVersion").value("unknown"));
        environmentResponse("  ", true).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                .jsonPath("$.serverVersion").value("unknown"));
    }

    @Test
    void Flyway_이력_테이블이_없어도_200이고_스키마_버전은_unknown이다() throws Exception {
        environmentResponse(null, false)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.schemaVersion").value("unknown"));
    }
}
