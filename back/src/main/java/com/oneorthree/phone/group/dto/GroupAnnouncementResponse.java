package com.oneorthree.phone.service.dto.group;

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
