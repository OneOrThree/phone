package com.oneorthree.business.linkpreview.dto;

public record Preview(String id, String status, String originalUrl, String title, String mimeType,
        Long sizeBytes, String provider, String thumbnailUrl, String errorCode) {
}
