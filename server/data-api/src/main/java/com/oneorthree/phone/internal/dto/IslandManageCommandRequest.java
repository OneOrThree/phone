package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.oneorthree.phone.group.dto.CreateGroupRequest;

import java.util.Map;
import java.util.Set;

/**
 * {@code PATCH /internal/islands/{islandId}} 본문 (GROMO-1802, 섬 관리 LLD §2·§3.1).
 *
 * <p>세 필드 모두 선택이고 <b>키가 없으면 미변경, 명시한 null 은 거절</b>이다 — 그래서 필드를 바로 받지 않고
 * 원본 맵에서 키 존재와 값을 따로 본다. 소개를 비우려면 빈 문자열을 보낸다. 계약 밖 키(password·maxMembers·
 * isPrivate 등)는 옛 잠금·정원을 이 경로로 바꾸지 못하게 거절한다.
 *
 * <p>이름 안전 문자 규칙은 {@link CreateGroupRequest#NAME_PATTERN} 하나가 정의다 — 섬 생성
 * ({@link CreateIslandCommandRequest})과 같은 경계를 쓴다. 거절은 전부 400 {@code INVALID_REQUEST} 다.
 *
 * @param name             새 이름 — null 이면 미변경
 * @param intro            새 소개 — null 이면 미변경
 * @param approvalRequired 새 가입 방식 — null 이면 미변경
 */
public record IslandManageCommandRequest(String name, String intro, Boolean approvalRequired) {

    private static final Set<String> KEYS = Set.of("name", "intro", "approvalRequired");
    private static final int NAME_MAX = 50;
    private static final int INTRO_MAX = 200;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static IslandManageCommandRequest fromJson(Map<String, Object> fields) {
        if (fields == null || !KEYS.containsAll(fields.keySet())) {
            throw new IllegalArgumentException("섬 정보 수정 요청의 필드가 올바르지 않습니다.");
        }
        String name = text(fields, "name");
        if (name != null && (name.isBlank() || name.length() > NAME_MAX
                || !name.matches(CreateGroupRequest.NAME_PATTERN))) {
            throw new IllegalArgumentException("섬 이름이 올바르지 않습니다.");
        }
        String intro = text(fields, "intro");
        if (intro != null && intro.length() > INTRO_MAX) {
            throw new IllegalArgumentException("섬 소개가 너무 깁니다.");
        }
        Boolean approvalRequired = null;
        if (fields.containsKey("approvalRequired")) {
            if (!(fields.get("approvalRequired") instanceof Boolean value)) {
                throw new IllegalArgumentException("가입 방식은 boolean 이어야 합니다.");
            }
            approvalRequired = value;
        }
        return new IslandManageCommandRequest(name, intro, approvalRequired);
    }

    private static String text(Map<String, Object> fields, String key) {
        if (!fields.containsKey(key)) {
            return null;
        }
        if (!(fields.get(key) instanceof String value)) {
            throw new IllegalArgumentException(key + " 는 문자열이어야 합니다.");
        }
        return value;
    }
}
