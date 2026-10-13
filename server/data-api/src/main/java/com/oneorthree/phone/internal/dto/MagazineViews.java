package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.magazine.support.MagazineEditorial;
import com.oneorthree.phone.magazine.support.PromotionContent;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 고양이 잡지 읽기·받음 상태 계약 (GROMO-2289, 잡지 구현 계획 §3-6~3-9). */
public final class MagazineViews {

    private MagazineViews() {
    }

    /** 섬에서 바라본 칸의 섬 — 읽는 순간 계산한다. */
    public enum Relation {
        /** 지금 내 소속 섬 — 앱은 동그라미 대신 「우리 섬이에요」. */
        MEMBER,
        /** 내가 강퇴된 섬 — 동그라미 없음. */
        KICKED,
        NONE
    }

    /** 받은 곳 — 바다(펠리컨) · 섬(우체통). 바다 화면 전에는 늘 섬이다. */
    public enum Place {
        SEA,
        ISLAND
    }

    /**
     * 오늘 호와 내 받음 상태 — 호가 한 번도 나오지 않았으면 {@code issue} 가 null, 아직 안 받았으면 {@code receipt} 가
     * null 이다. 앱은 issue 가 있고 receipt 가 null 이면 배달 연출을 띄운다.
     */
    public record Today(IssueSummary issue, Receipt receipt) {
    }

    /**
     * @param current 현재 호인가 — 가장 최근 호이고 다음 날 07:00 KST 전. 아니면 앱이 망원경 동그라미를 그리지 않는다
     */
    public record IssueSummary(UUID issueId, int issueNo, LocalDate issueDate, Instant publishedAt, boolean current) {
    }

    public record Receipt(Place place, Instant receivedAt, Instant deferredAt, Instant openedAt) {
    }

    /** 받음·나중에·읽음 — {@code deferred}·{@code opened} 는 생략할 수 있고 true 만 의미가 있다(되돌리지 않는다). */
    public record ReceiptRequest(@NotNull Place place, Boolean deferred, Boolean opened) {
    }

    /** 최근 7호(잡지 꽂이) — 최신 호가 먼저다. */
    public record Shelf(List<ShelfItem> items) {
    }

    /** @param opened 한 번이라도 펼쳤나 — 아니면 빨간 점 */
    public record ShelfItem(UUID issueId, int issueNo, LocalDate issueDate, Instant publishedAt, boolean opened) {
    }

    /**
     * 호 한 페이지 — {@code editorial} 은 첫 페이지(경계 없음)에만 싣는다. 다음 페이지 경계는 둘 다 있거나 둘 다 null 이다.
     */
    public record IssuePage(IssueSummary issue, Editorial editorial, List<Cell> cells, Instant nextAppliedAt,
                            UUID nextPromotionId) {
    }

    public record Editorial(List<RankedIsland> ranking, List<Island> newIslands, MagazineEditorial.Note note) {
    }

    public record RankedIsland(int rank, UUID islandId, String name, int buildingCount, int memberCount,
                               int maxMembers, Integer averageFocusMinutesPerDay, Relation relation) {
    }

    public record Island(UUID islandId, String name, int buildingCount, int memberCount, int maxMembers,
                         Integer averageFocusMinutesPerDay, Relation relation) {
    }

    /** 홍보 칸 — 숫자는 발행 때 고정한 값이고, 글·배치는 00시 마감으로 굳은 홍보 행 그대로다. */
    public record Cell(UUID promotionId, UUID islandId, String name, int buildingCount, int memberCount,
                       int maxMembers, Integer averageFocusMinutesPerDay, String body, PromotionContent.Layout layout,
                       Relation relation) {
    }
}
