package com.oneorthree.business.upstream.link.dto;

import java.util.UUID;

/**
 * 매치 결과. 기존 앱 계약({@code InviteMatchResponse})을 그대로 재현한다 — {@code matched=false} 도
 * <b>200</b> 이고 {@code slug}·{@code groupId} 는 JSON 에서 빠진다.
 *
 * <p><b>오류를 {@code matched:false} 로 접지 않는다</b>: 앱은 「서버 응답을 받았다」만으로 확인 완료
 * 플래그를 세우고 다음 실행에서 재시도하지 않으므로, 판정 불가를 false 로 주면 <b>되돌릴 수 없는</b>
 * 미매치가 된다. 그래서 상류 실패는 5xx 로 올린다(계약 §4).
 */
public record LinkMatchResult(boolean matched, String slug, UUID groupId) {
}
