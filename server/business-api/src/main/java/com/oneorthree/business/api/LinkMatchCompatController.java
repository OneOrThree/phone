package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.InviteMatchRequest;
import com.oneorthree.business.api.dto.InviteMatchResponse;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.ClientIpResolver;
import com.oneorthree.business.common.http.IpHasher;
import com.oneorthree.business.upstream.link.dto.LinkMatchResult;
import com.oneorthree.business.usecase.CompatMatchUseCase;
import com.oneorthree.business.usecase.RequestIdempotencyKeys;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이관 정지 창의 <b>한시</b> {@code POST /l/match} 핸들러 (A22 ㊫ · 서비스 §7.2 3~6단계).
 *
 * <h2>왜 여기 있는가</h2>
 * 정지 창 동안 nginx 가 {@code /l/match} 를 이 핸들러로 보낸다. 구·신 양쪽 후보를 동시에 보아야 하는
 * 주체는 Business 뿐이다(링크는 코어를 못 부르고, Data → 링크는 relay 외 금지). <b>컷오버 후
 * 제거한다</b> — 그래서 {@code business.compat.match-handler-enabled} 기본값이 false 이고, 꺼진 동안은
 * 404 처럼 보인다.
 *
 * <h2>무인증이다 — 의도된 것이다</h2>
 * {@code /l/*} 는 {@code AccessTokenFilter} 에 등록하지 않았다. 여기 도달하는 사람은 아직 우리 유저가
 * 아니고(설치 직후 첫 실행), 현 {@code LinkPublicController} 도 무인증이다. 인증을 붙이면 구 앱의
 * deferred 매치가 전멸한다.
 *
 * <p>그래서 <b>방문자 입력을 그대로 상류에 넘기지 않는다</b>: {@code ipHash} 는 신뢰한 프록시의 원본
 * IP 로만 만들고, 나머지는 {@code @Valid} 제약을 통과한 값만 전달한다.
 */
@RestController
@RequiredArgsConstructor
public class LinkMatchCompatController {

    private final CompatMatchUseCase compatMatchUseCase;
    private final ClientIpResolver clientIpResolver;
    private final IpHasher ipHasher;

    /**
     * <b>실패도 200 {@code {"matched": false}}</b> 가 기존 계약이지만, 그건 「매치되지 않았다」는 판정에만
     * 적용된다. 상류 장애는 전역 핸들러가 5xx 로 올린다 — 판정 불가를 false 로 주면 앱이 「확인 완료」
     * 플래그를 세우고 다음 실행에서 재시도하지 않아 그 설치의 초대가 <b>영구히 사라진다</b>.
     */
    @PostMapping(value = "/l/match", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<InviteMatchResponse> match(
            @Valid @RequestBody InviteMatchRequest request,
            HttpServletRequest httpRequest) {

        String ipHash = ipHasher.hash(clientIpResolver.resolve(httpRequest));
        // deviceId 를 멱등 키의 근거로 쓴다 — 구 앱은 실패 시 다음 실행에서 같은 deviceId 로 다시 보내고,
        // 「같은 deviceId 재시도는 같은 결과」가 계약이다(계약 §4). 본문 해시가 아니라 기기 식별자다.
        RequestIdempotencyKeys keys = RequestIdempotencyKeys.from("match:" + request.deviceId());

        LinkMatchResult result = compatMatchUseCase.match(
                ipHash, request.os(), request.deviceId(), request.appInstanceId(), keys);

        if (result == null) {
            throw new UpstreamContractMismatchException("링크 매치 응답에 본문이 없습니다");
        }
        if (!result.matched()) {
            return ResponseEntity.ok(InviteMatchResponse.notMatched());
        }
        if (result.slug() == null || result.slug().isBlank() || result.groupId() == null) {
            throw new UpstreamContractMismatchException("링크 매치 성공 응답에 식별자가 없습니다");
        }
        return ResponseEntity.ok(InviteMatchResponse.matched(result.slug(), result.groupId()));
    }
}
