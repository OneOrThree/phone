package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.IslandNoticeResponses;
import com.oneorthree.business.api.dto.IslandNoticeResponses.NoticeCommentCreatedView;
import com.oneorthree.business.api.dto.IslandNoticeResponses.NoticeDeletedView;
import com.oneorthree.business.api.dto.IslandNoticeResponses.NoticeView;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandNoticeUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Set;
import java.util.UUID;

/**
 * 섬 게시판 6종의 <b>공개 경계</b> (GROMO-1771, island-board LLD §1·§2) — 공지 목록·상세·작성·수정·삭제와 댓글 작성.
 *
 * <p>여기서 하는 것은 입력의 «모양» 검증뿐이다. 주민·게시판 완공·작성 권한·멱등·version 은 Data 가 판정하고
 * {@link IslandNoticeUseCase} 가 코드만 옮긴다. 주체는 AT 에서만 온다 — 본문에 사용자 id 를 받지 않는다.
 * 네 쓰기는 {@code Idempotency-Key}(UUID36)가 필수다(정책 B07). 성공 봉투는 공통 advice 가 씌운다.
 *
 * <p>입력 규칙(LLD §1·§2, 정책 B05·B06): JSON object 만, 미지 필드·명시 null·잘못된 타입은 400
 * {@code INVALID_REQUEST}. 공백만인 제목·본문·댓글, 100 UTF-16 단위를 넘는 제목, NUL 문자는 422
 * {@code OUT_OF_RANGE}. 본문·댓글의 길이 상한은 BQ03 임시값이라 Data 설정이 판정한다.
 */
@RestController
@RequiredArgsConstructor
public class IslandNoticeController {

    private static final int TITLE_MAX_UTF16 = 100;
    private static final char NUL = '\0';
    private static final Set<String> PATCH_FIELDS = Set.of("title", "body");

    private final IslandNoticeUseCase notices;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/islands/{islandId}/notices")
    public IslandNoticeResponses.Page list(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return notices.list(claims, PublicIds.uuid(islandId, "islandId"), single(request, "cursor"),
                properties.deadline());
    }

    @GetMapping("/islands/{islandId}/notices/{noticeId}")
    public IslandNoticeResponses.Detail detail(@PathVariable String islandId, @PathVariable String noticeId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return notices.detail(claims, PublicIds.uuid(islandId, "islandId"), PublicIds.uuid(noticeId, "noticeId"),
                single(request, "commentsCursor"), properties.deadline());
    }

    @PostMapping(value = "/islands/{islandId}/notices", consumes = "application/json")
    public ResponseEntity<NoticeView> create(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        if (body == null || !body.isObject() || body.size() != 2 || !body.has("title") || !body.has("body")) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        NoticeView created = notices.create(claims, island, title(body.get("title")),
                text(body.get("body"), "body"), key, properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /** 부분 수정 — title/body 중 하나 이상, 생략은 유지, 명시 null·빈 값은 거절(정책 B06). */
    @PatchMapping(value = "/islands/{islandId}/notices/{noticeId}", consumes = "application/json")
    public NoticeView update(@PathVariable String islandId, @PathVariable String noticeId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        UUID notice = PublicIds.uuid(noticeId, "noticeId");
        if (body == null || !body.isObject() || body.isEmpty() || !PATCH_FIELDS.containsAll(body.propertyNames())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        String title = body.has("title") ? title(body.get("title")) : null;
        String text = body.has("body") ? text(body.get("body"), "body") : null;
        return notices.update(claims, island, notice, title, text, key, properties.deadline());
    }

    /** 삭제 — 본문을 읽지 않는다. 200 {@code deleted=true}(legacy 의 204 와 섞지 않는다). */
    @DeleteMapping("/islands/{islandId}/notices/{noticeId}")
    public NoticeDeletedView delete(@PathVariable String islandId, @PathVariable String noticeId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return notices.delete(claims, PublicIds.uuid(islandId, "islandId"), PublicIds.uuid(noticeId, "noticeId"), key,
                properties.deadline());
    }

    /** 댓글 — 정확히 {@code text} 하나. 작성자는 AT 주체이고 대리 userId 입력이 없다. */
    @PostMapping(value = "/islands/{islandId}/notices/{noticeId}/comments", consumes = "application/json")
    public ResponseEntity<NoticeCommentCreatedView> comment(@PathVariable String islandId,
            @PathVariable String noticeId, @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        UUID notice = PublicIds.uuid(noticeId, "noticeId");
        if (body == null || !body.isObject() || body.size() != 1 || !body.has("text")) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        NoticeCommentCreatedView created = notices.comment(claims, island, notice,
                text(body.get("text"), "text"), key, properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    // ---------------------------------------------------------------- 입력 해석

    /** 제목 — 문자열이 아니면 400, 공백만·100 UTF-16 초과·NUL 은 422(정책 B05). */
    private static String title(JsonNode node) {
        String value = text(node, "title");
        if (value.length() > TITLE_MAX_UTF16) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "title");
        }
        return value;
    }

    /** 본문·댓글 공통 — 문자열이 아니면(명시 null 포함) 400, 공백만·NUL 은 422. 길이 상한은 Data 가 본다. */
    private static String text(JsonNode node, String field) {
        if (node == null || !node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        String value = node.stringValue();
        if (value.isBlank() || value.indexOf(NUL) >= 0) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return value;
    }

    /** 쿼리 파라미터 하나 — 같은 키가 여러 번 오면 400 이다({@code IslandMailboxController} 와 같다). */
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
