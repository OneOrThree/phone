package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.oneorthree.phone.user.support.CatColors;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 공개 {@code PATCH /me} 의 내부 본문 (GROMO-1801·1945·1971). Business 가 공개 본문을 검증한 뒤 온 필드만 싣는다 —
 * 카탈로그 밖 {@code catColor} 는 Business 가 422 로 끝내므로 여기 오면 계약 위반이라 400 이다. 세 필드 중 하나
 * 이상 필수이고, 문자열 외 타입·명시 null·미지 필드도 400 이다.
 *
 * <p>{@code mainIslandId} 는 <b>형식만</b> 여기서 본다 — 「그 섬의 주민인가」는 Data 만 알 수 있고 잠금 아래에서
 * 판정해야 하므로 {@code MainIslandService.choose} 가 403 {@code MEMBER_ONLY} 로 거절한다.
 *
 * @param name         새 닉네임 원문(trim 전). {@code null} = 미변경. 형식·중복 판정은 기존 닉네임 writer 가 한다
 * @param catColor     {@link CatColors} 의 색. {@code null} = 미변경
 * @param mainIslandId 새 메인 섬 id. {@code null} = 미변경
 */
public record AccountPatchRequest(String name, String catColor, UUID mainIslandId) {

    private static final Set<String> FIELDS = Set.of("name", "catColor", "mainIslandId");

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static AccountPatchRequest fromJson(Map<String, Object> fields) {
        if (fields == null || fields.isEmpty() || !FIELDS.containsAll(fields.keySet())) {
            throw new IllegalArgumentException("계정 요청의 필드가 올바르지 않습니다.");
        }
        if (fields.containsKey("name") && !(fields.get("name") instanceof String)) {
            throw new IllegalArgumentException("name 은 문자열이어야 합니다.");
        }
        if (fields.containsKey("catColor")
                && !(fields.get("catColor") instanceof String color && CatColors.IDS.contains(color))) {
            throw new IllegalArgumentException("catColor 는 카탈로그의 색이어야 합니다.");
        }
        return new AccountPatchRequest((String) fields.get("name"), (String) fields.get("catColor"),
                mainIslandId(fields.get("mainIslandId"), fields.containsKey("mainIslandId")));
    }

    private static UUID mainIslandId(Object raw, boolean present) {
        if (!present) {
            return null;
        }
        if (!(raw instanceof String value)) {
            throw new IllegalArgumentException("mainIslandId 는 문자열이어야 합니다.");
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("mainIslandId 는 UUID 여야 합니다.", e);
        }
    }
}
