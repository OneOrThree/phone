package com.oneorthree.business.common.request;

/**
 * keyset의 마지막 정렬 값과 동률 PK. 호출자는 시각·숫자·무작위 탐색 핸들처럼 비민감 키만 사용한다.
 * 이름·검색어·초대 코드 등 비밀 값의 암호화 수단이 아니다.
 */
public record CursorBoundary(String sortKey, String tieBreaker) {

    public CursorBoundary {
        if (sortKey == null || sortKey.isEmpty() || sortKey.length() > 256
                || tieBreaker == null || tieBreaker.isEmpty() || tieBreaker.length() > 128) {
            throw new IllegalArgumentException("유한한 정렬 키와 동률 키가 필요합니다.");
        }
    }
}
