package com.oneorthree.business.common.api;

/**
 * 409의 최신 공개 상태. 호출자가 동일 snapshot에서 현재 인가와 공개 DTO를 검증한 뒤에만 만든다.
 * 상류 JSON/영속 엔티티를 자동으로 전달하는 통로가 아니다.
 */
public record PublicCurrentState(long version, Object resource) {

    public PublicCurrentState {
        if (version < 0 || version > 9_007_199_254_740_991L || resource == null) {
            throw new IllegalArgumentException("A public current state requires a safe version and resource");
        }
    }
}
