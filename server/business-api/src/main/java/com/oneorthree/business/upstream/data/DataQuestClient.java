package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.IslandQuestViews;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.islandPath;

/**
 * 섬 퀘스트 6종의 Data 호출 (GROMO-1773, 삭제 GROMO-2897) — 공개 경로 앞에 {@code /internal} 을 붙인
 * 이름이다(island-quests LLD §2).
 */
public class DataQuestClient {

    private static final String PATH_QUESTS = "/internal/islands/{islandId}/quests";
    private static final String PATH_QUESTS_CURRENT = "/internal/islands/{islandId}/quests/current";

    private final InternalHttpClient http;

    public DataQuestClient(InternalHttpClient http) {
        this.http = http;
    }

    /** 현재 퀘스트 회차 (GROMO-1773). 멱등 GET 이라 재시도한다 — 판정은 전부 상류 몫이다. */
    public IslandQuestViews.Current fetchCurrentQuests(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_QUESTS_CURRENT, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Current>() { });
    }

    /** 회차 진행 (GROMO-1773). 회차 id 만 질의로 싣는다 — 커서는 Business 가 판정한다. */
    public IslandQuestViews.Progress fetchQuestProgress(UUID userId, UUID islandId, UUID questId,
            UUID occurrenceId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, questPath(islandId, questId) + "/progress")
                        .onBehalfOf(userId)
                        .query("occurrenceId", occurrenceId.toString())
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Progress>() { });
    }

    /** 퀘스트 생성 (GROMO-1773). 앱 키를 그대로 전달해 같은 키의 재시도는 Data 의 receipt 재생이다. */
    public IslandQuestViews.Created createQuest(UUID userId, UUID islandId, QuestCreateCommand command, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_QUESTS, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(command)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Created>() { });
    }

    /** 퀘스트 정의 수정 (GROMO-1773). 생략 필드는 유지 — null 로 실리면 상류도 «유지»로 읽는다. */
    public IslandQuestViews.Updated updateQuest(UUID userId, UUID islandId, UUID questId, String title,
            Integer targetMinutes, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, questPath(islandId, questId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new QuestUpdateCommand(title, targetMinutes))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Updated>() { });
    }

    /**
     * 퀘스트 삭제 (GROMO-2897). 본문 없는 204 다. 앱 키를 그대로 전달해 같은 키의 재시도는 Data 의
     * receipt 재생이다 — 이미 지운 퀘스트를 새 키로 지우면 404 다.
     */
    public void deleteQuest(UUID userId, UUID islandId, UUID questId, UUID key, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.DELETE, questPath(islandId, questId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /** 회차 정산 (GROMO-1773). expectedVersion 은 지문에 들어가 같은 키의 다른 본문은 재사용 거절이 된다. */
    public IslandQuestViews.Claimed claimQuest(UUID userId, UUID islandId, UUID questId, UUID occurrenceId,
            long expectedVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, questPath(islandId, questId) + "/claims")
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new QuestClaimCommand(occurrenceId, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Claimed>() { });
    }

    private static String questPath(UUID islandId, UUID questId) {
        return islandPath(PATH_QUESTS, islandId) + "/" + questId;
    }

    /**
     * 퀘스트 생성 요청 본문 (GROMO-1773). 창 필드는 focus 만 — screen 이면 null 이고, Data 는 null 을 «없음»으로
     * 읽는다. {@code timezone} 은 앱이 보낸 값 그대로(생략이면 null)다.
     */
    public record QuestCreateCommand(String title, String type, int targetMinutes, String windowStart,
                                     String windowEnd, String timezone) {
    }

    /** 퀘스트 수정 요청 본문 (GROMO-1773). */
    record QuestUpdateCommand(String title, Integer targetMinutes) {
    }

    /** 회차 정산 요청 본문 (GROMO-1773). */
    record QuestClaimCommand(UUID occurrenceId, long expectedVersion) {
    }
}
