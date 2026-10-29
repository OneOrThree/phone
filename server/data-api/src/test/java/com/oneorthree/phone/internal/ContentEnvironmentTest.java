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
    void 다른_환경의_이력은_조회하지_않는다() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("prod"));
        var history = mock(ContentHistoryService.class);
        var request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Backoffice-Environment")).thenReturn("dev");
        var controller = new InternalContentAdminController(mock(DeveloperNoticeService.class), history,
                mock(MagazineReviewService.class), environment, jdbc);

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
                environment, jdbc);

        assertThatThrownBy(() -> controller.publishNotice(UUID.randomUUID(), null, request))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("요청 환경");
        verifyNoInteractions(notices);
    }
}
