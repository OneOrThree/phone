package com.oneorthree.business.api;

import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 파일 링크 미리보기(GROMO-1747)는 앱 호출부가 없어 GROMO-2682 에서 통째로 걷었다 — 라우트가 되살아나면 실패한다.
 *
 * <p>인증된 요청으로 부른다. AT 가 없으면 컨트롤러가 있든 없든 필터가 401 로 끊어 «라우트 부재»를 증명하지 못한다.
 * 되살릴 때는 제거 커밋을 되돌리고(docs/prd/fishcat/decision-log.md) 이 테스트를 함께 지운다.
 */
class LinkPreviewRemovedTest extends UpstreamTestBase {

    @ParameterizedTest
    @ValueSource(strings = {"/link-previews", "/api/v1/link-previews"})
    void removedRoutesReturn404(String path) throws Exception {
        mockMvc.perform(post(path)
                        .header("Authorization", "Bearer " + Tokens.access(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"urls\":[\"https://example.com/guide.pdf\"]}"))
                .andExpect(status().isNotFound());
    }
}
