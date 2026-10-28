package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * Data 의 우체통 인가 결과이자 최소 표시 projection — {@code name} 뿐이다 (GROMO-1775).
 *
 * <p>{@code catColor} 는 없다: 그 컬럼이 어느 서비스에도 없고, {@code null} 은 이미 「탈퇴·비노출」이라는 뜻이라
 * 대체값으로 쓸 수 없다. 외양 도메인(1783 계열)이 생기면 필드가 «추가»된다.
 *
 * @param userId 사용자
 * @param name   표시 이름. 탈퇴 계정은 null
 */
public record MailboxViewer(UUID userId, String name) {
}
