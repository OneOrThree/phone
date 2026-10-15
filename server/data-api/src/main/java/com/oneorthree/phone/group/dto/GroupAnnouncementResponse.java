package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

/**
 * 그룹 공지 한 건. 본문까지 함께 실려 목록 응답을 그대로 상세 화면에 쓸 수 있다.
 */
@Getter
@Builder
public class GroupAnnouncementResponse {
    private UUID id;
    private String title;
    private String content;
    private Instant createdAt;
}
