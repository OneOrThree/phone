package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * 한 페이지의 작성자 id — 상한은 히스토리 limit 최대(100)와 같다.
 *
 * @param userIds 표시 이름이 필요한 작성자들. Business 가 «방금 읽은 페이지의 sender 집합»만 넘긴다
 */
public record MessageAuthorsRequest(@NotEmpty @Size(max = 100) List<@NotNull UUID> userIds) {
}
