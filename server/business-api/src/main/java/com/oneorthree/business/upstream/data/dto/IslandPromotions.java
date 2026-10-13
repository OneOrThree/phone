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
 * 잡지 홍보 신청·섬 소식 Data 응답 (GROMO-2267) 과 고양이 잡지 편집·신고·기록판 응답 (GROMO-2289) — Data
 * {@code IslandPromotionViews} 와 같은 필드이고, 공개 응답과 모양이 같아 그대로 내보낸다({@link Report} 만 {@code created}
 * 를 떼어 {@link Reported} 로 내보낸다). 필수 필드가 빠지거나 null 이면 계약 불일치(502)다.
 *
 * <p>{@code layout} 은 Business 가 속을 보지 않는 JSON 객체다 — 판정(프레임·스티커·테이프)은 Data 하나가 한다.
 * 문서 스키마만 {@code Map} 으로 그린다: springdoc 이 Jackson 3 {@code ObjectNode} 를 {@code string} 으로 그려서다.
 */
public final class IslandPromotions {

    private IslandPromotions() {
    }

    /**
     * 신청 결과 — {@code issueDate} 는 실릴 호(KST 날짜), {@code feeFish} 는 이번에 낸 홍보비(고정 60),
     * {@code newsId} 는 주민 전원에게 생긴 소식이다.
     */
    @Schema(name = "IslandPromotion")
    public record Created(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID promotionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int feeFish,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int balanceAfter,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID newsId) {
    }

    /** 최신순 소식 목록. */
    @Schema(name = "IslandNewsPage")
    public record NewsPage(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items) {
    }

    /** 소식 한 건 — {@code kind} 는 지금 {@code PROMOTION} 하나이고 모르는 종류도 그대로 내려온다. */
    @Schema(name = "IslandNewsItem")
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String kind,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt) {
    }

    /** 고친 홍보 — 전체 교체 결과다. */
    @Schema(name = "IslandPromotionUpdated")
    public record Updated(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID promotionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL)
            @Schema(implementation = Map.class) ObjectNode layout,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant updatedAt) {
    }

    /**
     * 섬장의 편집 화면 — 신청 창·다음 호에 낸 홍보({@code next})·지난 호 홍보({@code latest})·홍보비·섬 통장 잔액.
     * {@code next}·{@code latest} 는 없으면 null 이고 키는 늘 실린다.
     */
    @Schema(name = "IslandPromotionEditor")
    public record Editor(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Window window,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Next next,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Latest latest,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int feeFish,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long balance,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean privateIsland) {
    }

    /** 신청 창 — {@code issueDate} 호의 신청을 {@code opensAt}~{@code closesAt} 에 받는다. */
    @Schema(name = "IslandPromotionWindow")
    public record Window(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean open,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant opensAt,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant closesAt) {
    }

    /** 다음 호에 낸 홍보 — {@code editable} 이 false 면 자정이 지나 고칠 수 없다. */
    @Schema(name = "IslandPromotionNext")
    public record Next(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID promotionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL)
            @Schema(implementation = Map.class) ObjectNode layout,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant appliedAt,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean editable) {
    }

    /** 이미 나간 가장 최근 호의 홍보. */
    @Schema(name = "IslandPromotionLatest")
    public record Latest(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID promotionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL)
            @Schema(implementation = Map.class) ObjectNode layout) {
    }

    /**
     * Data 의 홍보 칸 신고 결과 (GROMO-2289) — {@code created} 는 Data 의 HTTP 상태(201 새 신고 / 200 이미 한 신고)를 본문에
     * 실어 온 것이다. 상류 클라이언트가 응답 본문만 돌려주기 때문이다(망원경 핀과 같다). 공개 응답에는 싣지 않는다.
     */
    public record Report(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean reported,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean created) {
    }

    /** 공개 신고 결과 — 새 신고면 201, 이미 신고했으면 200 으로 같은 본문이다. */
    @Schema(name = "IslandPromotionReported")
    public record Reported(@JsonProperty(required = true) boolean reported) {
    }

    /** 주민이 보는 우리 섬 홍보 기록판 (GROMO-2289) — 최신순. */
    @Schema(name = "IslandPromotionRecordPage")
    public record RecordPage(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL, contentNulls = Nulls.FAIL)
            List<RecordItem> items) {
    }

    /**
     * 홍보 기록 한 건 — {@code issueNo} 는 아직 호가 나오지 않았으면 null 이고 키는 늘 실린다. {@code layout} 은 섬장이
     * 꾸민 칸 그대로(기록판의 작은 칸 그림용, 늘 있다). {@code status} 는 {@code SCHEDULED}·{@code PUBLISHED}·
     * {@code SKIPPED}·{@code HIDDEN}·{@code REMOVED}, 숫자 셋은 그 홍보를 거쳐 망원경에 넣은·도착한·가입한 사람 수다.
     */
    @Schema(name = "IslandPromotionRecord")
    public record RecordItem(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID promotionId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String issueDate,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer issueNo,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL)
            @Schema(implementation = Map.class) ObjectNode layout,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int pinned,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int arrived,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int joined) {
    }

    /** 내 꾸미기 재료 — 프레임·스티커·테이프, 각 재료의 보유 여부. */
    @Schema(name = "MagazineAssets")
    public record Assets(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Asset> frames,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Sticker> stickers,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Asset> tapes) {
    }

    /** 프레임·테이프 한 개 — {@code bundle} 은 {@code free}·{@code season}. */
    @Schema(name = "MagazineAsset")
    public record Asset(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String assetId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String bundle,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean owned) {
    }

    /** 스티커 한 개 — {@code tab} 은 {@code cat}·{@code sea}·{@code friends}·{@code deco}. */
    @Schema(name = "MagazineSticker")
    public record Sticker(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String assetId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String tab,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String bundle,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean owned) {
    }
}
