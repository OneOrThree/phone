package com.oneorthree.phone.character.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 누끼 이미지 유해성 검사 요청.
 *
 * <p>image 는 data URI 프리픽스({@code data:image/png;base64,}) 없는 순수 base64 PNG 문자열이다.
 * 이미지는 저장하지 않고 검사만 한다.</p>
 */
public record ImageModerationRequest(
        // base64 상한 10MB(원본 약 7.5MB 상당) — 누끼 캐릭터 이미지엔 충분하며, 무제한 페이로드를 막는다.
        @NotBlank
        @Size(max = 10 * 1024 * 1024, message = "이미지가 너무 큽니다.")
        String image
) {
}
