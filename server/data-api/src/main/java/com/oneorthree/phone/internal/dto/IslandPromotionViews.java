package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.magazine.support.PromotionContent;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 잡지 홍보 신청·고치기·불러오기, 꾸미기 재료, 섬 소식 응답 (GROMO-2267 · GROMO-2289, 섬 외부 계약 §7 · 잡지 구현 계획 §3).
 */
public final class IslandPromotionViews {

    private IslandPromotionViews() {
    }

    /**
     * 신청 결과.
     *
     * @param promotionId  새 홍보 칸
     * @param issueDate    실릴 호의 KST 날짜(신청한 날 + 1)
     * @param feeFish      이번에 낸 홍보비 — 고정 60마리
     * @param balanceAfter 차감 뒤 섬 통장 잔액
     * @param newsId       주민 전원에게 생긴 섬 소식 한 건의 id
     */
    public record Created(UUID promotionId, LocalDate issueDate, int feeFish, int balanceAfter, UUID newsId) {
    }

    /** 고치기 결과 — 저장된 정규형(앞뒤 공백을 뗀 글) 그대로다. */
    public record Updated(UUID promotionId, LocalDate issueDate, String body, PromotionContent.Layout layout,
                          Instant updatedAt) {
    }

    /**
     * 쓰기 화면 불러오기.
     *
     * @param window        지금 열려 있거나 다음에 열릴 신청 창
     * @param next          아직 발행되지 않은 이 섬의 홍보(없으면 null) — 창 안이면 고칠 수 있다
     * @param latest        지난번에 실은 칸(없으면 null) — {@code next} 가 없을 때 화면이 이것으로 연다
     * @param feeFish       홍보비(60)
     * @param balance       섬 통장 잔액
     * @param privateIsland 비공개 섬이면 신청이 막힌다
     */
    public record Editor(Window window, Next next, Latest latest, int feeFish, int balance,
                         boolean privateIsland) {
    }

    /**
     * 신청 창 — {@code issueDate} 호의 창은 전날 07:00 KST({@code opensAt})부터 그날 00:00 KST({@code closesAt}) 전까지다.
     * 닫혀 있는(00~07시) 동안은 다음에 열릴 창이다.
     */
    public record Window(boolean open, LocalDate issueDate, Instant opensAt, Instant closesAt) {
    }

    /** @param editable 지금 신청 창 안이라 고칠 수 있나 — 00~07시에는 오늘 07시 호가 오되 false 다 */
    public record Next(UUID promotionId, LocalDate issueDate, String body, PromotionContent.Layout layout,
                       Instant appliedAt, boolean editable) {
    }

    /** @param body 운영이 내린 칸이면 빈 글이다 — 위반 글을 그대로 다시 싣지 않게 꾸미기만 불러온다 */
    public record Latest(UUID promotionId, LocalDate issueDate, String body, PromotionContent.Layout layout) {
    }

    /** 꾸미기 재료 — 종류별, 정렬 순서대로. */
    public record Assets(List<Asset> frames, List<Sticker> stickers, List<Asset> tapes) {
    }

    /**
     * 틀·테이프 한 종.
     *
     * @param bundle {@code free}(모두가 가진 것) · {@code season}(바다 시즌 보상)
     * @param owned  지금 쓸 수 있나 — 퇴역하지 않은 무료 재료이거나 보유 행이 있다
     */
    public record Asset(String assetId, String bundle, boolean owned) {
    }

    /** @param tab 스티커 서랍 탭 — {@code cat} · {@code sea} · {@code friends} · {@code deco} */
    public record Sticker(String assetId, String tab, String bundle, boolean owned) {
    }

    /** 최신순 소식 목록. */
    public record NewsPage(List<NewsItem> items) {
    }

    /** @param kind 소식의 종류 — 지금은 {@code PROMOTION} 하나이고, 모르는 종류도 그대로 내려간다 */
    public record NewsItem(UUID id, String kind, String body, Instant createdAt) {
    }
}
