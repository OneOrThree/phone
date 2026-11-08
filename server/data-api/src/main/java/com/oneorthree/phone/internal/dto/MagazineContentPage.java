package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.magazine.support.IslandCard;
import com.oneorthree.phone.magazine.support.MagazineEditorial;
import com.oneorthree.phone.magazine.support.PromotionContent;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 운영자가 발행된 호를 읽는 페이지. 숨김 처리한 홍보도 상태와 함께 보여 준다. */
public record MagazineContentPage(UUID issueId, LocalDate issueDate, int issueNo, int promotionCount,
                                 MagazineEditorial editorial, List<Cell> cells, String nextCursor) {
    public record Cell(UUID promotionId, IslandCard card, String body,
                       PromotionContent.Layout layout, String moderation) { }
}
