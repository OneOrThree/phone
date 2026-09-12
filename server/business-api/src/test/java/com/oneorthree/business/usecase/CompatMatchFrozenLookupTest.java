package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.config.CompatProperties;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.link.LinkApiClient;
import com.oneorthree.business.upstream.link.dto.LinkMatchCommand;
import com.oneorthree.business.upstream.link.dto.LinkMatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 구 정지 후보 조회의 실패를 <b>어느 단계에서 삼키는가</b>.
 *
 * <p>같은 조회지만 4단계 전후로 그 실패가 뜻하는 바가 정반대다. 준비 전에는 「몇 건이 아직 구 쪽에
 * 있나」를 세는 관측이라 실패해도 Neon 후보만으로 매치가 성립하지만, import 계약이 열린 뒤의 빈
 * 목록은 「구 쪽에 후보가 없다」는 <b>사실 주장</b>이고 링크는 그 주장을 믿고 소진을 확정한다.
 *
 * <p>앱은 「응답을 받았다」만으로 확인 완료를 기록하고 다음 실행에서 재시도하지 않으므로, 조회 실패를
 * 빈 목록으로 접으면 그 설치의 귀속이 <b>영구히</b> 사라진다.
 */
@DisplayName("구 정지 후보 조회 실패의 단계별 처리")
class CompatMatchFrozenLookupTest {

    private static final String MIGRATION = "mig-1";
    private static final String IP_HASH = "ip-hash";
    private static final String OS = "ios";

    private CompatProperties properties;
    private DataApiClient dataApiClient;
    private LinkApiClient linkApiClient;
    private CompatMatchUseCase useCase;

    @BeforeEach
    void setUp() {
        properties = new CompatProperties();
        properties.setMatchHandlerEnabled(true);
        properties.setMigrationId(MIGRATION);
        dataApiClient = mock(DataApiClient.class);
        linkApiClient = mock(LinkApiClient.class);
        useCase = new CompatMatchUseCase(properties, dataApiClient, linkApiClient);
        given(linkApiClient.match(any(), anyString(), any()))
                .willReturn(new LinkMatchResult(false, null, null));
    }

    private LinkMatchResult match() {
        return useCase.match(IP_HASH, OS, "device-1", "install-1",
                RequestIdempotencyKeys.from(UUID.randomUUID().toString()));
    }

    /**
     * 관측 단계의 조회 실패는 삼킨다 — 이관 도구의 장애가 <b>정상 설치의 초대를 전멸시키면</b> 안 된다.
     * 이때 링크로 가는 요청에는 {@code migrationId} 가 실리지 않는다(import 모드로 들어가면 503 이다).
     */
    @Test
    @DisplayName("import 계약 준비 전이면 조회가 실패해도 Neon 후보만으로 매치를 진행한다")
    void observationStageStillMatchesWhenTheFrozenLookupFails() {
        properties.setImportContractReady(false);
        given(dataApiClient.exportFrozenCandidates(anyString(), anyString(), anyString(), any()))
                .willThrow(new UpstreamTimeoutException("구 DB 조회 시간 초과"));

        assertThat(match().matched()).isFalse();

        ArgumentCaptor<LinkMatchCommand> sent = ArgumentCaptor.forClass(LinkMatchCommand.class);
        verify(linkApiClient).match(sent.capture(), anyString(), any());
        assertThat(sent.getValue().migrationId())
                .as("준비 전에는 migrationId 를 생략해야 직접 매치 경로를 탄다")
                .isNull();
    }

    /**
     * import 계약이 열린 뒤의 조회 실패는 <b>올린다</b>. 빈 목록으로 접으면 「구 쪽에 없다」는 거짓
     * 주장이 링크로 가 소진이 확정되고, 앱은 확인 완료를 기록해 다시 시도하지 않는다.
     */
    @Test
    @DisplayName("import 계약이 열린 뒤의 조회 실패는 매치를 확정하지 않고 상류 실패로 올린다")
    void importStagePropagatesTheFailureInsteadOfClaimingThereAreNoFrozenCandidates() {
        properties.setImportContractReady(true);
        given(dataApiClient.exportFrozenCandidates(anyString(), anyString(), anyString(), any()))
                .willThrow(new UpstreamTimeoutException("구 DB 조회 시간 초과"));

        assertThatThrownBy(this::match).isInstanceOf(UpstreamTimeoutException.class);

        verify(linkApiClient, never()).match(any(), anyString(), any());
    }

    /** 조회가 «성공»한 빈 목록은 그대로 사실이다 — 그때는 확정해도 된다. */
    @Test
    @DisplayName("조회가 성공한 빈 목록은 그대로 넘긴다 — 실패와 «후보 없음»을 가른다")
    void anEmptyResultThatActuallyCameBackIsStillAValidClaim() {
        properties.setImportContractReady(true);
        given(dataApiClient.exportFrozenCandidates(anyString(), anyString(), anyString(), any()))
                .willReturn(List.of());

        assertThat(match().matched()).isFalse();

        ArgumentCaptor<LinkMatchCommand> sent = ArgumentCaptor.forClass(LinkMatchCommand.class);
        verify(linkApiClient).match(sent.capture(), anyString(), any());
        assertThat(sent.getValue().migrationId()).isEqualTo(MIGRATION);
        assertThat(sent.getValue().frozenCandidates()).isEmpty();
    }
}
