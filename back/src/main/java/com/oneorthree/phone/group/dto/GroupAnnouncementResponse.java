package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

@Getter
@Builder
public class GroupAnnouncementResponse {
    private Long id;
    private String title;
    private String content;
    private Instant createdAt;
}
