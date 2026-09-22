package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.LetterSlice;
import com.oneorthree.business.upstream.data.dto.LetterView;
import com.oneorthree.business.usecase.LetterUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/**
 * 편지 4종의 <b>공개 표면</b> (GROMO-1933 발송·목록·상세 + GROMO-2002 닫기) — 무접두 {@code /letters…}
 * 는 nginx 위성 include 의 Business 분기가 보내고, 실제 판정은 Data 의 {@code /internal/users/{userId}/…}
 * 가 한다.
 *
 * <p>{@code PublicApiRoutes.ROOTS} 의 {@code /letters/**} 가 봉투를 씌운다(GROMO-1894 가 이미 열어 둠).
 *
 * <p><b>Idempotency-Key 를 요구하지 않는다.</b> 발송은 멱등키 적용표(api-platform LLD §2)에 없는
 * 명령이다 — 응답 유실 뒤의 재시도는 같은 편지를 두 통 만들 수 있어 앱 키 없이 상류 재시도도 하지
 * 않는다.
 *
 * <p>주체는 AT 에서만 온다({@link SettingsSessionGuard#requireSession}). 입력 해석 도우미는
 * {@code FriendController} 와 같다 — 본문 형태·UUID 는 여기서 거르고 값 판정(빈 본문·길이·친구
 * 여부·우체통 게이트)은 Data 가 한다.
 */
@RestController
@RequiredArgsConstructor
public class LetterController {

    private final LetterUseCase letters;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /**
     * 편지 보내기 (LLD §1.12). 본문은 {@code receiverId}·{@code content} 둘뿐이다 — 다른 키가 섞이면
     * 거절한다. 201 응답은 방금 만든 편지 한 통이다.
     */
    @PostMapping(value = "/letters", consumes = "application/json")
    public ResponseEntity<LetterView> send(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (body == null || !body.isObject() || body.size() != 2) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode receiver = body.get("receiverId");
        JsonNode content = body.get("content");
        if (receiver == null || !receiver.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "receiverId");
        }
        if (content == null || !content.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "content");
        }
        LetterView sent = letters.send(claims, uuid(receiver.stringValue(), "receiverId"),
                content.stringValue(), deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(sent);
    }

    /**
     * 편지함 목록 (LLD §1.13). {@code type}·{@code cursor}·{@code size} 는 전부 선택이다 — 화면 조각이
     * 파라미터 없이 부른다. {@code cursor}·{@code size} 의 <b>형식</b>만 여기서 거른다 — 그대로
     * 넘기면 Data 의 UUID/Integer 변환 실패가 매핑표에 없는 400 이라 공개 502 로 번역된다.
     * 범위·기본값·알 수 없는 {@code type} 의 400 판정은 계속 Data 가 한다.
     */
    @GetMapping("/letters")
    public LetterSlice letters(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        String cursor = request.getParameter("cursor");
        String size = request.getParameter("size");
        if (cursor != null) {
            uuid(cursor, "cursor");
        }
        if (size != null) {
            integer(size, "size");
        }
        return letters.letters(claims, request.getParameter("type"), cursor, size, deadline());
    }

    /** 편지 상세 (LLD §1.14). 수신자의 첫 조회는 읽음을 박는다 — 행은 지워지지 않는다. */
    @GetMapping("/letters/{letterId}")
    public LetterView letter(@PathVariable String letterId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return letters.letter(claims, uuid(letterId, "letterId"), deadline());
    }

    /**
     * 편지 닫기 (GROMO-2002) — 수신자만. 「열었다가 닫으면 지워지고 보낸 사람 목록에서도 사라진다」의
     * 그 닫기다. 상세(GET)에 삭제를 얹지 않은 이유는 Data 의 {@code InternalLetterService.close} 에 있다.
     *
     * <p>LLD 의 204 는 공개 봉투 규칙으로 200 {@code {"data": null}} 이 된다({@code FriendController.deleteFriend}
     * 선례). 두 번째 호출은 404 다 — 멱등 200 으로 접지 않는다.
     */
    @DeleteMapping("/letters/{letterId}")
    public ResponseEntity<Void> close(@PathVariable String letterId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        letters.close(claims, uuid(letterId, "letterId"), deadline());
        return ResponseEntity.noContent().build();
    }

    private static UUID uuid(String value, String field) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
    }

    /** 숫자 형식만 거른다 — 값의 범위 판정(1~100)은 Data 의 {@code INVALID_PAGE_REQUEST} 몫이다. */
    private static int integer(String value, String field) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}
