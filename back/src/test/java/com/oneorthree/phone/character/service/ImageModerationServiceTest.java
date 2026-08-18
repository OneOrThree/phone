package com.oneorthree.phone.character.service;

import com.oneorthree.phone.character.client.OpenAiModerationClient;
import com.oneorthree.phone.character.client.OpenAiModerationClient.OpenAiModerationResult;
import com.oneorthree.phone.character.dto.ImageModerationRequest;
import com.oneorthree.phone.character.dto.ImageModerationResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;

/**
 * 누끼 모더레이션 게이트 테스트 — 저장 전 필수 관문이라 "막혔는가"와 "왜 막혔는가"를 모두 잠근다.
 */
@ExtendWith(MockitoExtension.class)
class ImageModerationServiceTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final ImageModerationRequest REQUEST = new ImageModerationRequest("dGVzdA==");

    @Mock
    private OpenAiModerationClient openAiModerationClient;

    @InjectMocks
    private ImageModerationService imageModerationService;

    @Test
    @DisplayName("유해하지 않으면 통과 — allowed=true, 검사 불가 아님")
    void passesWhenNotFlagged() {
        given(openAiModerationClient.moderate(REQUEST.image()))
                .willReturn(new OpenAiModerationResult(false, List.of()));

        ImageModerationResponse response = imageModerationService.moderate(USER_ID, REQUEST);

        assertThat(response.allowed()).isTrue();
        assertThat(response.unavailable()).isFalse();
        assertThat(response.flaggedCategories()).isEmpty();
    }

    @Test
    @DisplayName("유해 판정이면 차단 — 카테고리를 실어 보내고 검사 불가는 아니다")
    void blocksWhenFlagged() {
        given(openAiModerationClient.moderate(REQUEST.image()))
                .willReturn(new OpenAiModerationResult(true, List.of("violence")));

        ImageModerationResponse response = imageModerationService.moderate(USER_ID, REQUEST);

        assertThat(response.allowed()).isFalse();
        assertThat(response.unavailable()).isFalse();
        assertThat(response.flaggedCategories()).containsExactly("violence");
    }

    /**
     * fail-closed 의 핵심 — 검사를 못 했으면 통과시키지 않는다. 동시에 그게 '유해'가 아니라
     * '검사 불가'임을 앱이 알아야, 정상 사진을 올린 사용자에게 사진 탓을 하지 않는다(GROMO-1197).
     */
    @Test
    @DisplayName("검사 실패(키 미설정·타임아웃·5xx)는 차단하되 '검사 불가'로 표시한다")
    void failsClosedAndMarksUnavailable() {
        willThrow(new IllegalStateException("OPENAI_API_KEY 미설정"))
                .given(openAiModerationClient).moderate(REQUEST.image());

        ImageModerationResponse response = imageModerationService.moderate(USER_ID, REQUEST);

        assertThat(response.allowed()).isFalse();
        assertThat(response.unavailable()).isTrue();
        assertThat(response.flaggedCategories()).isEmpty();
    }
}
