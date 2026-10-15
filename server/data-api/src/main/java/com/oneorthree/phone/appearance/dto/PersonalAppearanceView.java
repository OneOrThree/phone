package com.oneorthree.phone.appearance.dto;

/**
 * 개인 외양 스냅샷 — GET /me/inventory 의 equipped 와 PATCH /me/appearance 의 data 가 공유한다.
 * version 은 users_appearance_version 축이다.
 */
public record PersonalAppearanceView(
        String clothes,
        String decor,
        String hull,
        String position,
        long version) {
}
