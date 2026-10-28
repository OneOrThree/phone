package com.oneorthree.business.api;

import jakarta.servlet.http.HttpServletResponse;

/**
 * 로그인 201 에 1회용 기기 등록 자격을 싣는 응답 헤더 (계정 LLD §2.1 · GROMO-2037).
 *
 * <p>LLD §2.1: 「기존 {@code deviceBootstrap} 전달은 신규 응답의 {@code X-Device-Bootstrap} 헤더로
 * 보존한다(기술 결정). 앱은 이 값을 기존 기기 등록 DTO 의 deviceBootstrap 으로 전달한다. <b>본문
 * 4필드는 유지</b>하며 헤더도 자격이므로 저장소/로그/공용 캐시에 노출하지 않는다.」
 *
 * <h2>왜 한 자리인가</h2>
 * 이 값을 싣는 공개 경로가 소셜 로그인·게스트 시작 둘이다. 각자 {@code setHeader} 를 부르면 한쪽이
 * 빈 값을 그대로 싣거나(아래 참고) 헤더 이름 철자가 갈려도 아무도 모른다 — 앱은 헤더가 «없는» 것과
 * 이름이 틀린 것을 구분하지 못하고, 둘 다 조용히 자격 없는 등록 경로로 내려간다.
 *
 * <p>{@code no-store} 는 {@code RequestEnvelopeFilter} 가 모든 공개 응답에 이미 붙인다 — 여기서
 * 다시 붙이면 규칙이 두 곳이 되고, 한쪽만 고치는 날 공용 캐시에 자격이 남는다.
 */
final class DeviceBootstrapHeader {

    static final String NAME = "X-Device-Bootstrap";

    private DeviceBootstrapHeader() {
    }

    /**
     * 자격이 있을 때만 싣는다.
     *
     * <p>빈 값을 싣지 «않는» 것이 계약이다. 헤더가 있는데 값이 빈 문자열이면 앱은 「자격을 받았다」고
     * 믿고 그 값을 기기 등록에 실어 보내는데, 알림 서버는 그 값의 SHA-256 으로 세션 fence 를 만든다 —
     * 모든 기기가 <b>같은 fence</b> 를 공유하게 되어 한 기기의 세션 폐기가 남의 기기를 끊는다.
     * 없으면 아예 빼서, 앱이 기존 자격 없는 등록 경로로 내려가게 한다.
     *
     * @param bootstrap 1회용 자격 원문. 결과 재생(응답 유실 복구)에는 없다 — 원문을 보관하는 곳이
     *                  없어 상류가 되살리지 못한다
     */
    static void set(HttpServletResponse response, String bootstrap) {
        if (bootstrap != null && !bootstrap.isBlank()) {
            response.setHeader(NAME, bootstrap);
        }
    }
}
