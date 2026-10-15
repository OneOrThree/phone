package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 섬 공동 외양 — 섬({@code groups})당 한 행의 <b>전체 상태</b> (GROMO-1783, LLD §1.4·§2).
 *
 * <p>{@code buildingThemes} 의 key 집합은 그 섬의 <b>외양 대상 완공 건물 집합</b>이다 — GET 은
 * 이 맵을 그대로 내보내며 즉석에서 새 건물을 채우지 않는다. 새 건물의 {@code default} 반영은
 * 시설 완공 TX 가 이 행을 잠그고 한다.
 */
@Entity
@Table(name = "island_appearances")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandAppearance {

    /** 테마 해제의 예약 표현 — 상품 ID 와 충돌하지 않는다. */
    public static final String THEME_DEFAULT = "default";

    @Id
    @Column(name = "island_id")
    private UUID islandId;

    /** 적용 중인 섬 테마 상품 — 해제는 {@link #THEME_DEFAULT}. */
    @Column(name = "island_theme_id", nullable = false, length = 80)
    private String islandThemeId = THEME_DEFAULT;

    /** 완공 건물 → ThemeId|default 의 전체 맵. key 는 writer 만 늘린다. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "building_themes", nullable = false)
    private Map<String, String> buildingThemes = new LinkedHashMap<>();

    @Column(nullable = false)
    private long version = 0L;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    private IslandAppearance(UUID islandId, Instant now) {
        this.islandId = islandId;
        this.updatedAt = now;
    }

    public static IslandAppearance empty(UUID islandId, Instant now) {
        return new IslandAppearance(islandId, now);
    }

    /** 조회용 방어 복사본. */
    public Map<String, String> getBuildingThemes() {
        return new LinkedHashMap<>(buildingThemes);
    }

    /**
     * 병합된 전체 상태를 반영한다 — 호출부는 이미 권한·건물 키·kind·소유 검증을 끝냈다.
     * 실제 변경이 있을 때만 version 을 올린다.
     *
     * @return version 이 올랐으면 {@code true}
     */
    public boolean apply(String islandThemeId, Map<String, String> buildingThemes, Instant now) {
        if (this.islandThemeId.equals(islandThemeId) && this.buildingThemes.equals(buildingThemes)) {
            return false;
        }
        this.islandThemeId = islandThemeId;
        this.buildingThemes = new LinkedHashMap<>(buildingThemes);
        this.version += 1;
        this.updatedAt = now;
        return true;
    }

    /**
     * 시설 완공으로 새 건물이 외양 대상에 들어왔다 — 기본 테마를 반영한다.
     *
     * @return 맵이 실제로 바뀌었으면 {@code true} (이미 key 가 있으면 {@code false})
     */
    public boolean addBuilding(String buildingId, Instant now) {
        if (buildingThemes.containsKey(buildingId)) {
            return false;
        }
        Map<String, String> merged = new LinkedHashMap<>(buildingThemes);
        merged.put(buildingId, THEME_DEFAULT);
        this.buildingThemes = merged;
        this.version += 1;
        this.updatedAt = now;
        return true;
    }
}
