package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.group.support.IslandInputPolicy;

/**
 * 바다 한마디 변경 본문 (GROMO-2299, 계약 §2). 0~20 코드포인트이고 빈 문자열은 «지움» 이다. 앞뒤 공백은 잘라 판정한다.
 * 비어 있지 않으면 한 줄·보이는 글자가 있어야 한다(이름 안전 문자 규칙 재사용). 어기면 본문 파서 안의 예외라 400 이다.
 *
 * @param remark 정규화된 한마디 — 지움은 빈 문자열
 */
public record SeaRemarkRequest(String remark) {

    public static final int REMARK_MAX = 20;

    public SeaRemarkRequest {
        if (remark == null) {
            throw new IllegalArgumentException("한마디는 필수입니다(지우려면 빈 문자열).");
        }
        String stripped = remark.strip();
        if (stripped.codePointCount(0, stripped.length()) > REMARK_MAX) {
            throw new IllegalArgumentException("한마디는 20자 이하여야 합니다.");
        }
        if (!stripped.isEmpty() && !stripped.matches(IslandInputPolicy.NAME_PATTERN)) {
            throw new IllegalArgumentException("한마디는 한 줄이어야 합니다.");
        }
        remark = stripped;
    }
}
