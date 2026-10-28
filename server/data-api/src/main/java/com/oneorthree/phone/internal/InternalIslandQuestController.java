package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.QuestClaimRequest;
import com.oneorthree.phone.internal.dto.QuestCreateRequest;
import com.oneorthree.phone.internal.dto.QuestUpdateRequest;
import com.oneorthree.phone.quest.dto.QuestViews;
import com.oneorthree.phone.quest.service.IslandQuestService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 퀘스트의 내부 표면 (GROMO-1773) — 공개 {@code /islands/{islandId}/quests/**} 5종의 상류다
 * (bff-screens implementation-data-api.md 의 {@code GET /internal/islands/{islandId}/quests/current} 포함).
 *
 * <p>주체는 {@code InternalAuthFilter} 가 서비스 토큰과 함께 검증한 {@code X-User-Id} 헤더로만 받는다 —
 * 요청에 사용자 ID·권한·claimable·지급량을 받지 않는다(LLD §2).
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandQuestController {

    private final IslandQuestService quests;

    /** 현재 회차 목록 — 활성 주민·게시판 완공 섬만. */
    @GetMapping("/internal/islands/{islandId}/quests/current")
    public QuestViews.Current current(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId) {
        return quests.current(islandId, userId);
    }

    /** 회차 진행 — 판정 대상 전원. 지난 회차는 404 다(과거 이력 없음). */
    @GetMapping("/internal/islands/{islandId}/quests/{questId}/progress")
    public QuestViews.Progress progress(@PathVariable UUID islandId, @PathVariable UUID questId,
                                        @RequestParam UUID occurrenceId,
                                        @RequestHeader("X-User-Id") UUID userId) {
        return quests.progress(islandId, userId, questId, occurrenceId);
    }

    /** 퀘스트 생성 — 방장만. 오늘(UTC) 회차를 함께 연다. */
    @PostMapping("/internal/islands/{islandId}/quests")
    public QuestViews.Created create(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
                                     @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                     @RequestBody QuestCreateRequest body) {
        return quests.create(islandId, userId, body.title(), body.type(), body.targetMinutes(),
                body.windowStart(), body.windowEnd(), body.timezone(), idempotencyKey);
    }

    /** 정의 수정 — 방장만. 다음 회차부터 적용된다. */
    @PatchMapping("/internal/islands/{islandId}/quests/{questId}")
    public QuestViews.Updated update(@PathVariable UUID islandId, @PathVariable UUID questId,
                                     @RequestHeader("X-User-Id") UUID userId,
                                     @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                     @RequestBody QuestUpdateRequest body) {
        return quests.update(islandId, userId, questId, body.title(), body.targetMinutes(), idempotencyKey);
    }

    /** 회차 정산 — 주민 누구나 요청, 서버가 전체 cohort 로 판정한다. 적립처는 섬 통장이다. */
    @PostMapping("/internal/islands/{islandId}/quests/{questId}/claims")
    public QuestViews.Claimed claim(@PathVariable UUID islandId, @PathVariable UUID questId,
                                    @RequestHeader("X-User-Id") UUID userId,
                                    @RequestHeader("Idempotency-Key") UUID idempotencyKey,
                                    @Valid @RequestBody QuestClaimRequest body) {
        return quests.claim(islandId, userId, questId, body.occurrenceId(), body.expectedVersion(),
                idempotencyKey);
    }
}
