package com.oneorthree.realtime.message.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * 「여기까지 읽었다」 신고.
 *
 * @param lastReadMessageId 읽은 마지막 메시지 id(<b>포함</b>). 커서는 앞으로만 가므로 이보다 과거를
 *                          보내면 조용히 무시된다 — 옛 화면이 뒤늦게 보낸 신호가 배지를 되살리는 걸 막는다
 */
public record MarkReadRequest(
        @NotNull UUID lastReadMessageId
) {
}
