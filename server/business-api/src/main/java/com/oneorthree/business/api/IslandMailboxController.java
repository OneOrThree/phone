package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.MailboxMessageResponse;
import com.oneorthree.business.api.dto.MailboxPageResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandMailboxUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 우체통 편지방의 <b>공개 경계</b> (GROMO-1775, island-mailbox LLD §1·§2) — {@code GET/POST /islands/{islandId}/messages}.
 *
 * <p>여기서 하는 것은 입력의 «모양» 검증뿐이다. 주민·시설·중복·본문 규칙의 판정은 상류(Data·실시간)가 하고
 * {@link IslandMailboxUseCase} 가 코드만 옮긴다. 주체는 AT 에서만 온다({@link SettingsSessionGuard#requireSession}).
 * 성공 {@code {"data": …}} 봉투는 공통 advice 가 씌운다.
 *
 * <p>POST 에 {@code Idempotency-Key} 헤더를 요구하지 않는다 — 메시지 유일성의 정본은 본문의
 * {@code clientMessageId} 다(LLD §4 「일반 receipt 를 추가하지 않는다」).
 */
@RestController
@RequiredArgsConstructor
public class IslandMailboxController {

    /** 하이픈 포함 36자. version 비트는 보지 않는다(LLD §1 — v4/v7 권고이지 제한이 아니다). */
    private static final Pattern UUID_TEXT = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Pattern LIMIT_TEXT = Pattern.compile("[0-9]{1,3}");
    private static final int MAX_TEXT_UTF16 = 2000;
    private static final char NUL = '\u0000';

    private final IslandMailboxUseCase mailbox;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/islands/{islandId}/messages")
    public MailboxPageResponse list(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return mailbox.list(claims, PublicIds.uuid(islandId, "islandId"), single(request, "cursor"),
                limit(single(request, "limit")), properties.deadline());
    }

    @PostMapping(value = "/islands/{islandId}/messages", consumes = "application/json")
    public ResponseEntity<MailboxMessageResponse> send(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        // 정확히 두 필드 — senderId·receiverId·미지 필드는 거절한다(LLD §2). 주체는 AT 뿐이다.
        if (body == null || !body.isObject() || body.size() != 2
                || !body.has("clientMessageId") || !body.has("text")) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode key = body.get("clientMessageId");
        JsonNode text = body.get("text");
        if (key == null || !key.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "clientMessageId");
        }
        if (text == null || !text.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "text");
        }
        if (!UUID_TEXT.matcher(key.stringValue()).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_IDEMPOTENCY_KEY, "clientMessageId");
        }
        // strip 뒤 비어 있음·NUL·2000 UTF-16 초과는 422 — 실시간 서버와 같은 규칙(M10)을 공개 코드로 낸다.
        String stripped = text.stringValue().strip();
        if (stripped.isEmpty() || stripped.length() > MAX_TEXT_UTF16 || stripped.indexOf(NUL) >= 0) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "text");
        }
        MailboxMessageResponse sent = mailbox.send(claims, island, UUID.fromString(key.stringValue()),
                text.stringValue(), properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(sent);
    }

    /** {@code limit} — 생략은 30, 정수 토큰만, 1~100. 0 이하·상한 초과는 legacy 처럼 자르지 않고 400 이다(LLD §2). */
    private static int limit(String raw) {
        if (raw == null) {
            return IslandMailboxUseCase.DEFAULT_LIMIT;
        }
        if (!LIMIT_TEXT.matcher(raw).matches()) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
        int value = Integer.parseInt(raw);
        if (value < 1 || value > IslandMailboxUseCase.MAX_LIMIT) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
        return value;
    }

    /** 쿼리 파라미터 하나 — 같은 키가 여러 번 오면 400 이다({@code FocusSessionController} 와 같은 이유). */
    private static String single(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null || values.length == 0) {
            return null;
        }
        if (values.length > 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return values[0];
    }
}
