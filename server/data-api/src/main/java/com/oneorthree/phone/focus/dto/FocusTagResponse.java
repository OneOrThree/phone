package com.oneorthree.phone.focus.dto;

import java.util.UUID;

/**
 * 유저 소유(채택) 태그 1건 응답 (GROMO-673).
 *
 * <p>태그 정체성은 {@code default_tags} 지만, 유저 관점의 식별자는 채택 레코드
 * ({@code user_focus_tags})의 id 이다. 따라서 {@code tagId} 는 <b>user_focus_tags.id</b>,
 * {@code name} 은 참조하는 default_tag 의 이름이다.
 *
 * @param tagId user_focus_tags.id (세션의 focusTagId, 수정/삭제 대상 식별자)
 * @param name  참조 default_tag 의 이름
 */
public record FocusTagResponse(UUID tagId, String name) {
}
