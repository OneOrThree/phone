package com.oneorthree.business.upstream.data.dto;

import java.util.List;

/**
 * 한 페이지 작성자들의 표시 projection. 계정이 없는 id 는 빠져서 온다 — 그때 이름은 null 로 그린다.
 *
 * @param authors 요청 순서
 */
public record MessageAuthors(List<MailboxViewer> authors) {
}
