package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.group.support.IslandInputPolicy;

/**
 * 방명록 쓰기 본문 (GROMO-2262) — 1~20 코드포인트(🐟 = 1)의 한 줄. {@code @Size} 는 UTF-16 단위라 쓰지 않고
 * 여기서 거른다; 본문 파서 안의 예외는 읽기 실패 400 {@code INVALID_REQUEST} 로 나간다
 * ({@link IslandManageCommandRequest} 와 같은 결). 앞뒤 공백은 잘라 저장한다.
 *
 * <p>한 줄 규칙은 섬 이름·인사말과 같은 {@link IslandInputPolicy#NAME_PATTERN} 하나다(복사하지 않는다) —
 * 다른 사람에게 보이는 글이라 줄바꿈·탭 같은 제어문자와 양방향 제어문자(U+202E 등)는 레이아웃 깨기·글자 순서 속이기
 * 수단이 된다. 판정은 «자른 뒤» 값에 한다: 앞뒤 개행·공백은 잘려 통과하고, 공백·개행뿐이면 비어서 400 이다.
 */
public record GuestbookWriteRequest(String content) {

    public static final int CONTENT_MAX = 20;

    public GuestbookWriteRequest {
        String stripped = content == null ? "" : content.strip();
        if (stripped.isEmpty() || stripped.codePointCount(0, stripped.length()) > CONTENT_MAX) {
            throw new IllegalArgumentException("방명록은 1~20자여야 합니다.");
        }
        if (!stripped.matches(IslandInputPolicy.NAME_PATTERN)) {
            throw new IllegalArgumentException("방명록은 한 줄이어야 합니다.");
        }
        content = stripped;
    }
}
