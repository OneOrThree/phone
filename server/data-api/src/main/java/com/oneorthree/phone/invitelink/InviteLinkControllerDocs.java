package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.invitelink.dto.ClaimInviteRequest;
import com.oneorthree.phone.invitelink.dto.IssueInviteLinkResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code InviteLinkController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "InviteLink", description = "그룹 초대 링크")
public interface InviteLinkControllerDocs {

    /**
     * 초대 링크 발급 — 인증이 필요한 엔드포인트다(공개된 건 랜딩·매치 쪽이다).
     *
     * <p><b>멱등</b>이라 같은 (그룹, 초대자) 조합은 몇 번을 불러도 같은 slug 를 돌려준다.
     * 호출할 때마다 새 링크를 찍으면 이미 뿌린 링크가 늘어나 클릭 어트리뷰션이 흩어진다.
     *
     * @param groupId 초대할 그룹. 호출자가 이 그룹의 멤버인지 서버가 확인한다
     * @param userId {@code @LoginUser} 로 주입되는 초대자 — 클라이언트가 지정하는 값이 아니다.
     *               링크에 초대자가 박히므로 발급자와 클릭 보상 귀속 대상이 같아진다
     * @return 발급(또는 재사용)된 링크의 slug 와 공유용 URL
     */
    @Operation(summary = "초대 링크 발급", description = "(그룹, 로그인 유저)당 1개를 재사용하는 멱등 발급")
    ResponseEntity<IssueInviteLinkResponse> issueInviteLink(UUID groupId, UUID userId);

    /**
     * 초대 수락 — 가입·로그인 직후 앱이 1회 부른다.
     *
     * <p>이미 claim 됐거나 셀프 초대(자기 링크를 자기가 탄 경우)면 <b>에러가 아니라 no-op 200</b> 이다.
     * 앱이 재시도·중복 호출을 해도 흐름이 끊기지 않게 하려는 선택이라, 200 이 곧 "보상이 지급됐다"를
     * 뜻하지 않는다.
     *
     * @param request 수락할 초대의 slug
     * @param userId {@code @LoginUser} 로 주입되는 수락자. 요청 본문이 아니라 토큰에서 오므로
     *               남을 대신해 claim 할 수 없다
     * @return 204 가 아니라 본문 없는 200 — 성공·no-op 을 응답으로 구분하지 않는다
     */
    @Operation(summary = "초대 claim", description = "가입/로그인 직후 1회. 이미 claim 됐거나 셀프 초대면 no-op 200")
    ResponseEntity<Void> claim(ClaimInviteRequest request, UUID userId);
}
