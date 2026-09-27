package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.report.ReportMailGateway;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.DataReportClient;
import com.oneorthree.business.upstream.data.dto.ReportDeliveryView;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ReportUseCaseTest {

    @Test
    void emailConfirmedFinalizationFailureReleasesAndRetryConvergesWithoutAnotherMail() {
        UUID reporter = UUID.randomUUID();
        UUID author = UUID.randomUUID();
        UUID requestId = UUID.randomUUID();
        UUID lease = UUID.randomUUID();
        UUID confirmation = UUID.randomUUID();
        AccessTokenClaims claims = mock(AccessTokenClaims.class);
        when(claims.userId()).thenReturn(reporter);
        DataFriendClient data = mock(DataFriendClient.class);
        DataReportClient deliveries = mock(DataReportClient.class);
        UserBlockUseCase blocks = mock(UserBlockUseCase.class);
        ReportMailGateway mail = mock(ReportMailGateway.class);
        ReportUseCase useCase = new ReportUseCase(data, deliveries, blocks, mail);
        ReportDeliveryView confirmed = new ReportDeliveryView("EMAIL_CONFIRMED", "GR-CASE", confirmation,
                lease, author,
                null, null, true, null);
        when(deliveries.claim(eq(reporter), eq(requestId), any(), any(), eq(true), any())).thenReturn(confirmed);
        RuntimeException failure = new RuntimeException("block unavailable");
        doThrow(failure).doNothing().when(blocks).block(eq(claims), eq(author), any());
        ReportDeliveryView completed = new ReportDeliveryView("COMPLETED", "GR-CASE", confirmation, null, null,
                null, null, true, true);
        when(deliveries.complete(eq(reporter), eq(requestId), eq(lease), eq(true), any()))
                .thenReturn(completed);

        assertThatThrownBy(() -> report(useCase, claims, requestId, author)).isSameAs(failure);
        verify(deliveries).release(eq(reporter), eq(requestId), eq(lease), any());

        assertThat(report(useCase, claims, requestId, author).blocked()).isTrue();
        verify(mail, never()).deliverAndConfirm(any(), any());
        verify(deliveries, never()).emailConfirmed(any(), any(), any(), any());
    }

    private static ReportUseCase.ReportReceipt report(ReportUseCase useCase, AccessTokenClaims claims,
            UUID requestId, UUID author) {
        return useCase.report(claims, requestId, ReportUseCase.ReportTargetType.USER, author,
                ReportUseCase.ReportReason.HARASSMENT, null, null, true, Deadline.unbounded());
    }

}
