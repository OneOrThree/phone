package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.Map;

/** 운영 콘텐츠 이력의 커서 페이지 응답. */
public record ContentHistoryPage(List<Map<String, Object>> items, long total, String nextCursor) { }
