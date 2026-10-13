package com.oneorthree.phone.magazine.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 고양이 잡지의 실패 코드 (GROMO-2289, 잡지 구현 계획 §3-1). 상수 이름은 계약이다 — Business 가 같은 이름·같은 상태의
 * 공개 코드로 그대로 옮긴다. {@link #MAGAZINE_NOT_READY} 만 공개 {@code SERVICE_UNAVAILABLE} 로 바뀐다.
 *
 * <p>그대로 빌려 쓰는 기존 코드: 섬장 아님 {@code NOT_OWNER} · 이 호에 이미 신청 {@code PROMOTION_ALREADY_REQUESTED_TODAY}
 * (그룹) · 잔액 부족 {@code INSUFFICIENT_FUNDS}(건설) · 금칙어 {@code BANNED_WORD}(공통) · 게스트
 * {@code SOCIAL_LOGIN_REQUIRED}.
 */
@Getter
public enum MagazineErrorCode implements ErrorCode {

    /** 신청 창(KST 07:00~24:00) 밖의 새 신청 — 00~07시. */
    PROMOTION_WINDOW_CLOSED(HttpStatus.CONFLICT, "지금은 홍보를 신청할 수 없어요. 아침 7시에 다시 열려요"),

    /** 비공개 섬의 신청 — 비공개 섬은 잡지 어디에도 나오지 않는다(SAFE-03). */
    PROMOTION_PRIVATE_ISLAND(HttpStatus.CONFLICT, "비공개 섬은 잡지에 홍보할 수 없어요"),

    /** 홍보 글이 60자(코드 포인트)를 넘는다 — 금칙어 400 과 상태를 가른다(오류 계약 §4). */
    PROMOTION_TEXT_TOO_LONG(HttpStatus.UNPROCESSABLE_ENTITY, "홍보 글은 60자까지 쓸 수 있어요"),

    /** 빈 글·줄바꿈·배치 규칙 위반(틀 없음·스티커 11개·범위 밖 좌표·카탈로그에 없는 재료 …). */
    PROMOTION_LAYOUT_INVALID(HttpStatus.BAD_REQUEST, "홍보 칸 꾸미기 내용이 올바르지 않아요"),

    /** 섬장이 갖지 않았고 직전 칸에도 없던 재료. */
    PROMOTION_ASSET_NOT_OWNED(HttpStatus.FORBIDDEN, "갖고 있지 않은 꾸미기 재료가 있어요"),

    /** 신청 창 밖의 고치기 — 마감(00시)이 지났거나 이미 발행됐다(10/14 확정). */
    PROMOTION_LOCKED(HttpStatus.CONFLICT, "자정이 지나 홍보를 고칠 수 없어요"),

    /** 없는 홍보, 또는 다른 섬의 홍보. */
    PROMOTION_NOT_FOUND(HttpStatus.NOT_FOUND, "홍보를 찾을 수 없어요"),

    /** 없는 호, 또는 최근 7호보다 오래된 호(MAG-07 — 지난 호는 최근 7호까지만). */
    MAGAZINE_ISSUE_NOT_FOUND(HttpStatus.NOT_FOUND, "잡지 호를 찾을 수 없어요"),

    /** 기능 스위치 {@code magazine.enabled} 가 꺼져 있다 — 쓰기(신청·고치기)가 receipt·잠금보다 먼저 막힌다. */
    MAGAZINE_NOT_READY(HttpStatus.SERVICE_UNAVAILABLE, "고양이 잡지는 아직 준비 중이에요");

    private final HttpStatus status;
    private final String message;

    MagazineErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
