package com.oneorthree.phone.focus.dto;

import java.util.UUID;

public record FocusTagUpdateRequest(UUID tagId, String name) {
}
