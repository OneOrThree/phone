package com.oneorthree.phone.focus.dto;

import java.util.UUID;

/**
 * 태그 이름 변경 요청. 서버는 이걸 '옛 채택 행 소프트삭제 + 새 이름 재채택'으로 처리하므로
 * <b>성공 후 이 태그의 id 가 바뀐다</b> — 과거 세션은 서버가 새 행으로 재연결한다.
 *
 * @param tagId 변경할 채택 행 id. 남의 태그면 403, 직군 프리셋에서 온 태그면 400
 * @param name  새 이름. 지금 이름과 같으면 아무 일도 일어나지 않는다
 */
public record FocusTagUpdateRequest(UUID tagId, String name) {
}
