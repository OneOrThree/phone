package com.oneorthree.phone.internal.dto;

/**
 * 방명록 쓰기 본문 (GROMO-2262) — 1~20 코드포인트(🐟 = 1). {@code @Size} 는 UTF-16 단위라 쓰지 않고
 * 여기서 거른다; 본문 파서 안의 예외는 읽기 실패 400 {@code INVALID_REQUEST} 로 나간다
 * ({@link IslandManageCommandRequest} 와 같은 결). 앞뒤 공백은 잘라 저장한다.
 */
public record GuestbookWriteRequest(String content) {

    public static final int CONTENT_MAX = 20;

    public GuestbookWriteRequest {
        String stripped = content == null ? "" : content.strip();
        if (stripped.isEmpty() || stripped.codePointCount(0, stripped.length()) > CONTENT_MAX) {
            throw new IllegalArgumentException("방명록은 1~20자여야 합니다.");
        }
        content = stripped;
    }
}
