package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * 작성자 표시 projection 목록. 계정이 없는 id 는 빠진다 — 가짜 프로필을 만들지 않는다(LLD §5).
 *
 * @param authors       요청 순서, 중복 제거. 요청자가 차단한 사람은 들어 있지 않다
 * @param hiddenUserIds 요청한 id 중 <b>요청자가 차단한</b> 사람(GROMO-2181, character-report policy RP-차단).
 *                      Business 는 이 사람들의 메시지를 응답에서 뺀다. 방향 고정 — 요청자를 차단한 사람은
 *                      들어 있지 않다. 요청 순서, 중복 제거. 없으면 빈 목록
 */
public record MessageAuthorsResponse(List<MailboxViewerResponse> authors, List<UUID> hiddenUserIds) {
}
