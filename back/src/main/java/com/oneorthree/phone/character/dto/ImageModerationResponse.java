package com.oneorthree.phone.character.dto;

import java.util.List;

/**
 * 누끼 이미지 유해성 검사 결과.
 *
 * <p>allowed=false 면 유해로 판정돼 차단해야 한다. flaggedCategories 는 true 로 판정된
 * 카테고리 목록(예: sexual, sexual/minors, violence, self-harm 계열)이며, 통과 시엔 비어 있다.</p>
 */
public record ImageModerationResponse(
        boolean allowed,
        List<String> flaggedCategories
) {
}
