package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.auth.RevokedSessions;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataAuthClient;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Data 가 돌려준 sessionId 를 거부목록에 올리는지 — 기록 실패는 이미 커밋된 로그아웃을 실패시키지 않는다. */
class SessionLogoutUseCaseTest {
    private static final UUID SID = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    private static final LogoutCredentials CREDENTIALS = new LogoutCredentials("rt", null);

    private final DataAuthClient data = mock(DataAuthClient.class);
    private final RevokedSessions revokedSessions = mock(RevokedSessions.class);
    private final SessionLogoutUseCase useCase = new SessionLogoutUseCase(data, revokedSessions);

    private void dataReturns(String json) {
        when(data.logoutSession(any(), any())).thenReturn(JsonMapper.builder().build().readTree(json));
    }

    @Test
    void revokesSessionIdReturnedByData() {
        dataReturns("{\"revoked\":true,\"sessionId\":\"" + SID + "\"}");

        assertThat(useCase.logout(CREDENTIALS, Deadline.unbounded()).revoked()).isTrue();
        verify(revokedSessions).revoke(SID);
    }

    @Test
    void skipsWhenSessionIdMissingOrNull() {
        dataReturns("{\"revoked\":true}");
        assertThat(useCase.logout(CREDENTIALS, Deadline.unbounded()).revoked()).isTrue();
        dataReturns("{\"revoked\":true,\"sessionId\":null}");
        assertThat(useCase.logout(CREDENTIALS, Deadline.unbounded()).revoked()).isTrue();
        verify(revokedSessions, never()).revoke(any());
    }

    @Test
    void logoutStillSucceedsWhenRevokeFails() {
        dataReturns("{\"revoked\":true,\"sessionId\":\"" + SID + "\"}");
        doThrow(new IllegalStateException("redis down")).when(revokedSessions).revoke(SID);

        assertThat(useCase.logout(CREDENTIALS, Deadline.unbounded()).revoked()).isTrue();
    }
}
