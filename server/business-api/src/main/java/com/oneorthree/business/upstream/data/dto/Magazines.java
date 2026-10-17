package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 고양이 잡지 읽기 Data 응답 (GROMO-2289 발행) — 오늘 호·최근 7호·한 호 펼치기·받기 기록. 한 호 펼치기({@link IssuePage})만
 * 경계({@code nextAppliedAt}·{@code nextPromotionId})를 Business 가 서명 커서로 바꿔 {@link IssueView} 로 내보내고, 나머지는
 * 공개 응답과 모양이 같아 그대로 내보낸다. 필수 필드가 빠지거나 null 이면 계약 불일치(502)다.
 *
 * <p>null 일 수 있는 필드도 키는 늘 실린다({@code required} + {@code ALWAYS}) — 키가 빠지면 null 과 구분해 계약 불일치다.
 * {@code layout} 은 {@link IslandPromotions} 와 같이 Business 가 속을 보지 않는 JSON 객체다.
 */
public final class Magazines {

    private Magazines() {
    }

    /** 오늘 화면 — 아직 낸 호가 없으면 {@code issue} 가, 받은 적 없으면 {@code receipt} 가 null 이다. */
    @Schema(name = "MagazineToday")
    public record Today(
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Issue issue,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Receipt receipt) {
    }

    /** 호 머리 — {@code current} 는 지금 나와 있는 호(오늘 07시 발행분)인가. */
    @Schema(name = "MagazineIssue")
    public record Issue(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID issueId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int issueNo,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant publishedAt,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean current) {
    }

    /** 받기 기록 — {@code place} 는 {@code SEA}·{@code ISLAND}, 미루기·펼치기 전이면 그 시각이 null 이다. */
    @Schema(name = "MagazineReceipt")
    public record Receipt(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String place,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant receivedAt,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Instant deferredAt,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Instant openedAt) {
    }

    /** 최근 7호, 최신순. */
    @Schema(name = "MagazineIssues")
    public record Issues(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<IssueSummary> items) {
    }

    /** 지난 호 한 줄 — {@code opened} 는 내가 펼쳐 본 적 있는가. */
    @Schema(name = "MagazineIssueSummary")
    public record IssueSummary(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID issueId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int issueNo,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant publishedAt,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean opened) {
    }

    /**
     * Data 의 한 호 한 페이지 — 다음 경계 두 값은 둘 다 있거나 둘 다 null 이다(어긋나면 유스케이스가 계약 위반으로 접는다).
     * 두 키는 마지막 페이지에도 null 로 늘 실린다 — 키가 빠지면 null 과 구분해 계약 위반이다(마지막 페이지로 오인해 다음
     * 칸을 조용히 잃지 않게).
     */
    public record IssuePage(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Issue issue,
            @JsonProperty(required = true) Editorial editorial,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Cell> cells,
            @JsonProperty(required = true) Instant nextAppliedAt,
            @JsonProperty(required = true) UUID nextPromotionId) {
    }

    /** 공개 한 호 한 페이지 — {@code editorial} 은 첫 페이지에만 있고, {@code nextCursor} 는 서명 토큰이다. */
    @Schema(name = "MagazineIssuePage")
    public record IssueView(
            @JsonProperty(required = true) Issue issue,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Editorial editorial,
            @JsonProperty(required = true) List<Cell> cells,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
    }

    /** 편집부 지면 — 랭킹·새 섬·한마디(편집장 글 또는 팁 번호). */
    @Schema(name = "MagazineEditorial")
    public record Editorial(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<RankedIsland> ranking,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<IslandCard> newIslands,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Note note) {
    }

    /** 랭킹 한 줄 — {@code relation} 은 나와 그 섬의 관계({@code NONE}·{@code MEMBER}·{@code KICKED}). */
    @Schema(name = "MagazineRankedIsland")
    public record RankedIsland(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int rank,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int buildingCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int memberCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int maxMembers,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer averageFocusMinutesPerDay,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String relation) {
    }

    /** 새 섬 한 장 — 랭킹에서 순위만 뺀 모양이다. */
    @Schema(name = "MagazineIslandCard")
    public record IslandCard(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int buildingCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int memberCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int maxMembers,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer averageFocusMinutesPerDay,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String relation) {
    }

    /** 한마디 — {@code EDITOR} 면 {@code body}, {@code TIP} 이면 {@code tipNo} 만 있고 다른 쪽은 null 이다. */
    @Schema(name = "MagazineNote")
    public record Note(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String type,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String body,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer tipNo) {
    }

    /**
     * 홍보 칸 한 개 — 섬 요약 + 섬장이 쓴 글과 꾸미기 {@code layout}. {@code privateIsland} 는 읽는 시점의 섬 공개
     * 여부(GROMO-2305) — 선택 필드라 옛 Data 가 안 보내면 null 이고, null 이면 키를 싣지 않는다(망원경
     * 항목의 {@code magazineCell} 모양을 바꾸지 않는다). 비공개 섬은 망원경 핀이 404 라 앱이 동그라미를 숨긴다.
     */
    @Schema(name = "MagazineCell")
    public record Cell(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID promotionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int buildingCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int memberCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int maxMembers,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer averageFocusMinutesPerDay,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL)
            @Schema(implementation = Map.class) ObjectNode layout,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String relation,
            @JsonInclude(JsonInclude.Include.NON_NULL) Boolean privateIsland) {
    }
}
