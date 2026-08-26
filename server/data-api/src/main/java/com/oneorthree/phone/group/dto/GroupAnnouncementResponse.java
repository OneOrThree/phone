package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class GroupAnnouncementResponse {
    private UUID id;
    private String title;
    private String content;
    private Instant createdAt;
}
