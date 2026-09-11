package com.oneorthree.business.linkpreview.support;

/** 썸네일은 캐시 수명 동안만 보관하며 원본 바이트는 저장하지 않는다. */
public record PreviewContent(String title, String mimeType, Long sizeBytes, String provider, String thumbnailBase64) {
}
