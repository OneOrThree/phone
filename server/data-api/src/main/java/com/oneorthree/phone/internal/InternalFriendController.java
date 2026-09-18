package com.oneorthree.phone.internal;

import com.oneorthree.phone.friend.dto.FriendRequestCreateRequest;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.internal.dto.FriendRequestStateView;
import com.oneorthree.phone.internal.dto.FriendshipDeletedView;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 친구 7종의 <b>내부 표면</b> (GROMO-1894, friend-letter LLD §1.1~1.6 · §1.11 · §1.15) — 공개
 * {@code /friends…} 는 Business 의 {@code FriendController} 가 열고 여기는 그 위임만 받는다. 레거시
 * {@code /api/v1/friends…}({@code friend.FriendController})는 그대로 두고 동작도 바꾸지 않는다 — 두 표면이
 * 같은 {@code FriendService} 를 부른다.
 *
 * <p>경로 규칙은 B26(bff-screens policy)의 「본인 것만 읽는 조회는 {@code /internal/users/{userId}/…}」다 —
 * {@code InternalAuthFilter} 가 그 접두어에서 경로의 userId 와 {@code X-User-Id} 의 일치를 강제하므로
 * {@code @LoginUser} 대신 경로 변수로 주체를 받는다. 명령도 같은 축에 둔다(GROMO-1764·1759 선례).
 * 조회 이름 {@code friends}·{@code friend-requests} 는 LLD §1.15 그대로이고, 명령은 그 이름 아래에 둔다.
 *
 * <p>HLD §3 은 이 컨트롤러를 {@code friend} 패키지에 두자고 했지만 그 전제(「도메인 전용 내부 표면은
 * 도메인 패키지가 갖는다」)는 이미 깨져 있다 — 집중 세션·섬 소속·호스트 이전의 내부 표면이 전부 이
 * 패키지(L10)에 있다. 선례를 따른다.
 *
 * <p>응답은 {@code {"data": …}} 로 감싸지 않고(봉투는 Business 몫), 명령도 빈 본문 대신 결과 상태 한 겹을
 * 돌려준다({@link FriendRequestStateView}). Swagger 문서는 붙이지 않는다 — 서비스 간 계약이다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalFriendController {

    private final FriendService friendService;

    /** 친구 목록 (LLD §1.5). {@code date} 는 서버 판정 축(KST) 기준 오늘 — 값 판정은 서비스 그대로. */
    @GetMapping("/friends")
    public List<FriendResponse> friends(@PathVariable UUID userId,
                                        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return friendService.getFriends(userId, date);
    }

    /** 받은·보낸 PENDING 요청 목록 (LLD §1.6). 봉투 없는 배열이다 — raft 조각이 배열 길이를 센다(HLD §3). */
    @GetMapping("/friend-requests")
    public List<FriendRequestResponse> friendRequests(@PathVariable UUID userId, @RequestParam String type) {
        return friendService.getRequests(userId, type);
    }

    /** 친구 요청 생성 (LLD §1.1). 복원·재전환이면 되살린 행의 id 가 돌아온다. */
    @PostMapping("/friend-requests")
    @ResponseStatus(HttpStatus.CREATED)
    public FriendRequestStateView createRequest(@PathVariable UUID userId,
                                                @Valid @RequestBody FriendRequestCreateRequest body) {
        UUID requestId = friendService.createRequest(userId, body.getTargetUserId());
        return new FriendRequestStateView(requestId, FriendshipStatus.PENDING);
    }

    /** 요청 수락 (LLD §1.2) — 수신자만. 취소된 요청은 되살리지 못한다(§1.11). */
    @PostMapping("/friend-requests/{requestId}/accept")
    public FriendRequestStateView accept(@PathVariable UUID userId, @PathVariable UUID requestId) {
        friendService.acceptRequest(userId, requestId);
        return new FriendRequestStateView(requestId, FriendshipStatus.ACCEPTED);
    }

    /** 요청 거절 (LLD §1.3) — 수신자만, PENDING 한정. */
    @PostMapping("/friend-requests/{requestId}/reject")
    public FriendRequestStateView reject(@PathVariable UUID userId, @PathVariable UUID requestId) {
        friendService.rejectRequest(userId, requestId);
        return new FriendRequestStateView(requestId, FriendshipStatus.REJECTED);
    }

    /** 요청 취소 (LLD §1.11, 신규) — 발신자만, PENDING 한정. */
    @PostMapping("/friend-requests/{requestId}/cancel")
    public FriendRequestStateView cancel(@PathVariable UUID userId, @PathVariable UUID requestId) {
        friendService.cancelRequest(userId, requestId);
        return new FriendRequestStateView(requestId, FriendshipStatus.CANCELED);
    }

    /** 친구 삭제 (LLD §1.4) — 관계 양쪽 누구나. 탈퇴자와의 잔존 관계도 끊는다. */
    @DeleteMapping("/friends/{friendUserId}")
    public FriendshipDeletedView deleteFriend(@PathVariable UUID userId, @PathVariable UUID friendUserId) {
        return new FriendshipDeletedView(friendService.deleteFriend(userId, friendUserId));
    }
}
