package com.oneorthree.realtime.message;

import com.oneorthree.realtime.auth.LoginUser;
import com.oneorthree.realtime.message.dto.ChatHistoryResponse;
import com.oneorthree.realtime.message.dto.MailboxStoreResult;
import com.oneorthree.realtime.message.dto.SendMessageRequest;
import com.oneorthree.realtime.message.service.ChatMessageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 우체통 편지방의 <b>내부 어댑터</b> (GROMO-1775, island-mailbox LLD §3) — 공개 경로
 * {@code GET/POST /islands/{islandId}/messages} 는 Business 에 있고, 여기는 그 뒤에서 저장소를 여는
 * 서비스 간 표면이다. 자격은 {@code InternalServiceTokenFilter} 가, 주체는 {@code X-User-Id} 가 정한다.
 *
 * <p><b>인가를 여기서 하지 않는다.</b> 주민·시설 판정은 Business 가 Data 로 끝낸 뒤 호출한다. 그래서
 * legacy {@code ChatController} 와 달리 {@code ChatAccessGuard} 를 타지 않고, 집중 중 차단도 없다 —
 * 그건 정책 M12(MQ02 결정, 재영님 2026-09-18)다: 서버는 우체통을 집중·휴식으로 막지 않는다.
 *
 * <p>wire 는 legacy DTO 그대로다({@code ChatHistoryResponse}·{@code ChatMessageResponse} —
 * {@code messageId/senderId/content/sentAt}). 공개 이름({@code id/userId/text/createdAt})으로의
 * 변환은 Business 가 한다(LLD §2 「명시 매핑」). 여기서 이름을 바꾸면 legacy STOMP 와 모양이 갈린다.
 *
 * <p>{@code islandId} 는 곧 {@code groupId} 다 — Data 에 별도 섬 테이블이 없고 저장소도 group_id 다.
 */
@RestController
@RequestMapping("/internal/islands/{islandId}/messages")
@RequiredArgsConstructor
public class InternalMailboxController {

    private final ChatMessageService chatMessageService;

    /**
     * 최신부터 과거로 한 페이지. 커서·limit 의 «공개» 검증(서명 커서·1~100)은 Business 몫이고 여기는
     * 저장소 의미의 커서(id 미만)와 크기 clamp 만 한다.
     */
    @GetMapping
    public ChatHistoryResponse history(
            @PathVariable UUID islandId,
            @RequestParam(required = false) UUID cursor,
            @RequestParam(required = false) Integer limit,
            @LoginUser UUID userId) {
        return chatMessageService.historyForMailbox(islandId, cursor, limit);
    }

    /**
     * 저장 — 재전송이면 처음 저장된 그 메시지를 «같은 201»로 돌려준다(LLD §4-6 「HTTP 는 원 결과 201」).
     * 같은 키에 다른 본문이면 409 {@code IDEMPOTENCY_KEY_REUSED} 다.
     */
    @PostMapping
    public ResponseEntity<MailboxStoreResult> store(
            @PathVariable UUID islandId,
            @Valid @RequestBody SendMessageRequest request,
            @LoginUser UUID userId) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(chatMessageService.storeFromMailbox(islandId, userId, request));
    }
}
