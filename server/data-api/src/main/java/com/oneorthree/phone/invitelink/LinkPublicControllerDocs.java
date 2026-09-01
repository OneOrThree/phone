package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import com.oneorthree.phone.invitelink.dto.InviteMatchResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;

/**
 * {@code LinkPublicController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "InviteLink(public)", description = "무인증 초대 링크 — 랜딩·deferred 매치")
public interface LinkPublicControllerDocs {

    /**
     * 초대 랜딩 HTML — <b>미인증 공개 엔드포인트</b>다. 앱을 안 깐 사람, 검색 크롤러,
     * 카카오톡·슬랙 같은 메신저의 링크 프리뷰 봇이 모두 여기로 들어온다.
     *
     * <p><b>어떤 경우에도 200 HTML 을 돌려준다.</b> 없는 slug·삭제된 링크·사라진 그룹은
     * 404 가 아니라 "만료" 변형 페이지다 — 메신저 프리뷰가 404 를 만나면 링크가 깨진 것처럼
     * 보이고, 존재 여부가 응답 코드로 새면 slug 를 훑어 유효한 초대를 찾아낼 수 있다.
     * 부가 정보 조회(초대자 닉네임 등)가 실패해도 이 계약을 깨서는 안 된다.
     *
     * @param slug 경로에서 온 링크 식별자. 외부 입력이라 렌더링 전 이스케이프 대상이다
     * @param request 클릭 기록용 — IP·User-Agent·Referer 를 여기서 뽑는다.
     *                봇으로 분류된 클릭은 어트리뷰션 후보에서 빠진다
     * @return 200 + HTML. 만료 여부와 무관하게 스토어 버튼은 보여 준다
     */
    @Operation(summary = "초대 랜딩", description = "만료·미존재 slug 도 200 HTML(만료 변형)")
    ResponseEntity<String> landing(String slug, HttpServletRequest request);

    /**
     * 설치 후 초대 복원(deferred deep link) — 인증 전에 부르므로 <b>미인증 공개 엔드포인트</b>다.
     * 앱 최초 실행 시 "설치 직전에 어떤 초대 링크를 눌렀는지"를 되찾는다.
     *
     * <p>매칭은 IP 해시 + OS + 시간창이라 <b>확률적</b>이다. 그래서 결과로 자동 가입시키지 않고,
     * 앱은 반드시 초대 시트 확인을 거친다. 소진은 원자적이라 같은 클릭이 두 기기에 매칭되지 않는다.
     *
     * @param request 기기가 보고한 OS·설치 식별자. 외부 입력이라 그대로 신뢰하지 않는다
     * @param httpRequest IP 해시 키를 뽑기 위해 받는다 — 매칭 키의 한 축이라
     *                    프록시 헤더 신뢰 규칙({@code ClientIpResolver})이 그대로 정확도에 영향을 준다
     * @return 성공·실패 모두 200. 실패는 {@code {"matched": false}} 다 —
     *         4xx/5xx 로 내리면 앱이 "확인 완료" 플래그를 못 세워 매 실행마다 재시도 루프를 돈다
     */
    @Operation(summary = "deferred 매치",
            description = "IP해시+OS+시간창 fingerprint 로 미소진 클릭 1건을 원자적으로 소진")
    ResponseEntity<InviteMatchResponse> match(InviteMatchRequest request, HttpServletRequest httpRequest);
}
