package com.oneorthree.business.upstream.data.dto;

import java.util.List;
import java.util.UUID;

/**
 * 한 페이지 작성자들의 표시 projection. 계정이 없는 id 는 빠져서 온다 — 그때 이름은 null 로 그린다.
 *
 * @param authors       요청 순서
 * @param hiddenUserIds 요청한 id 중 요청자가 차단한 사람(GROMO-2181) — 그 사람의 메시지는 응답에서 뺀다.
 *                      필드가 없는(이전) Data 응답은 null 이고 «숨길 사람 없음»으로 읽는다
 */
public record MessageAuthors(List<MailboxViewer> authors, List<UUID> hiddenUserIds) {
}
