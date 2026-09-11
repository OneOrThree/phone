package com.oneorthree.chat.message.dto;

import java.util.List;
import java.util.UUID;

/**
 * 히스토리 한 페이지.
 *
 * @param messages <b>최신 → 과거</b> 순. 화면은 뒤집어 그린다. 서버가 이 순서로 주는 이유는
 *                 페이징 방향이 「위로(과거로)」이기 때문이다 — 자연스러운 커서 방향과 응답 순서를
 *                 맞춰 두면 앱이 두 방향을 헷갈릴 일이 없다
 * @param nextCursor 다음 «과거» 페이지를 요청할 때 그대로 넘길 값 = 이 페이지의 마지막(가장 오래된)
 *                   메시지 id. 더 없으면 null
 * @param hasMore 과거로 더 있는가. {@code nextCursor != null} 과 같은 뜻을 명시적으로도 준다 —
 *                앱이 null 검사를 잊고 무한 스크롤을 도는 흔한 실수를 줄인다
 */
public record ChatHistoryResponse(
        List<ChatMessageResponse> messages,
        UUID nextCursor,
        boolean hasMore
) {
}
