package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.IslandQuestViews;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 퀘스트 5종의 공개 유스케이스 (GROMO-1773, island-quests LLD §1~§5).
 *
 * <p>권한(방장·주민·게시판)·판정(cohort·달성·측정 대기)·지급은 전부 Data TX 가 한다 — Business 는 strict
 * 세션의 주체만 넘기고 도메인 실패를 공개 오류 표로 옮긴다. 표에 없는 (상태, 코드)는 그대로 올려
 * {@code registeredUpstream} 이 동명 공개 코드로 옮기거나 502 로 접는다(건설 유스케이스와 같은 규칙).
 */
@Service
@RequiredArgsConstructor
public class IslandQuestUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            Map.entry("MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            // 방장 아닌 주민의 생성·수정(D3).
            Map.entry("QUEST_FORBIDDEN", new PublicFailure(ApiErrorCode.FORBIDDEN, null)),
            Map.entry("QUEST_BOARD_LOCKED", new PublicFailure(ApiErrorCode.FACILITY_LOCKED, null)),
            Map.entry("QUEST_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "questId")),
            Map.entry("QUEST_OCCURRENCE_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "occurrenceId")),
            Map.entry("QUEST_INVALID_REQUEST", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            Map.entry("INVALID_REQUEST", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            Map.entry("QUEST_INVALID_TIMEZONE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "timezone")),
            Map.entry("QUEST_TITLE_OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, "title")),
            Map.entry("QUEST_TARGET_OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, "targetMinutes")),
            Map.entry("QUEST_WINDOW_OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, "windowEnd")),
            Map.entry("QUEST_VERSION_CONFLICT", new PublicFailure(ApiErrorCode.VERSION_CONFLICT, "expectedVersion")),
            // 미달성·측정 대기·다른 키로 이미 정산·수령 기한 지남 — 지급 없음(LLD §5).
            Map.entry("QUEST_STATE_CONFLICT", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "occurrenceId")),
            // 출시 스위치(policy.md 출시 조건) — 사유는 내부 코드로만 남긴다.
            Map.entry("QUEST_CREATION_UNAVAILABLE", new PublicFailure(ApiErrorCode.SERVICE_UNAVAILABLE, null)),
            Map.entry("QUEST_SETTLEMENT_UNAVAILABLE", new PublicFailure(ApiErrorCode.SERVICE_UNAVAILABLE, null)));

    private final DataApiClient data;

    public IslandQuestViews.Current current(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        return required(relay(() -> data.fetchCurrentQuests(claims.userId(), islandId, deadline)),
                "현재 퀘스트 응답이 없습니다");
    }

    public IslandQuestViews.Progress progress(AccessTokenClaims claims, UUID islandId, UUID questId,
            UUID occurrenceId, Deadline deadline) {
        IslandQuestViews.Progress progress = required(relay(() ->
                data.fetchQuestProgress(claims.userId(), islandId, questId, occurrenceId, deadline)),
                "퀘스트 진행 응답이 없습니다");
        if (!questId.toString().equals(progress.id()) || !occurrenceId.toString().equals(progress.occurrenceId())) {
            throw new UpstreamContractMismatchException("퀘스트 진행 응답의 대상이 요청과 다릅니다");
        }
        return progress;
    }

    public IslandQuestViews.Created create(AccessTokenClaims claims, UUID islandId,
            DataApiClient.QuestCreateCommand command, UUID key, Deadline deadline) {
        return required(relay(() -> data.createQuest(claims.userId(), islandId, command, key, deadline)),
                "퀘스트 생성 응답이 없습니다");
    }

    public IslandQuestViews.Updated update(AccessTokenClaims claims, UUID islandId, UUID questId, String title,
            Integer targetMinutes, UUID key, Deadline deadline) {
        IslandQuestViews.Updated updated = required(relay(() -> data.updateQuest(claims.userId(), islandId,
                questId, title, targetMinutes, key, deadline)), "퀘스트 수정 응답이 없습니다");
        if (!questId.toString().equals(updated.id())) {
            throw new UpstreamContractMismatchException("퀘스트 수정 응답의 id 가 요청과 다릅니다");
        }
        return updated;
    }

    /** 성공은 언제나 {@code claimed=true} 다 — 다른 값은 이 계약의 응답이 아니다. */
    public IslandQuestViews.Claimed claim(AccessTokenClaims claims, UUID islandId, UUID questId,
            UUID occurrenceId, long expectedVersion, UUID key, Deadline deadline) {
        IslandQuestViews.Claimed claimed = required(relay(() -> data.claimQuest(claims.userId(), islandId,
                questId, occurrenceId, expectedVersion, key, deadline)), "퀘스트 정산 응답이 없습니다");
        if (!claimed.claimed() || !occurrenceId.toString().equals(claimed.occurrenceId())
                || claimed.villagePointsAdded() < 0) {
            throw new UpstreamContractMismatchException("퀘스트 정산 응답이 계약과 다릅니다");
        }
        return claimed;
    }

    private static <T> T required(T value, String message) {
        if (value == null) {
            throw new UpstreamContractMismatchException(message);
        }
        return value;
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
            if (failure == null || failure.code().getStatus().value() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}
