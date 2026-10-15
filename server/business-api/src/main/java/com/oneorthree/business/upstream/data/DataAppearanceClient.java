package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.IslandAppearancePatchResult;
import com.oneorthree.business.upstream.data.dto.PersonalAppearancePatchResult;
import com.oneorthree.business.upstream.data.dto.PersonalInventory;
import com.oneorthree.business.upstream.data.dto.PlaybackPatchResult;
import com.oneorthree.business.upstream.data.dto.PlaybackState;
import com.oneorthree.business.upstream.data.dto.SharedInventory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.islandPath;
import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/**
 * 보유품·외양·공용 재생의 Data 호출 (GROMO-1783 · GROMO-1779) — 개인 축은
 * {@code /internal/users/{userId}}, 섬 축은 {@code /internal/islands/{islandId}}.
 */
public class DataAppearanceClient {

    private static final String PATH_MY_INVENTORY = "/internal/users/{userId}/inventory";
    private static final String PATH_MY_APPEARANCE = "/internal/users/{userId}/appearance";
    private static final String PATH_ISLAND_INVENTORY = "/internal/islands/{islandId}/inventory";
    private static final String PATH_ISLAND_APPEARANCE = "/internal/islands/{islandId}/appearance";
    private static final String PATH_ISLAND_PLAYBACK = "/internal/islands/{islandId}/playback";

    private final InternalHttpClient http;

    public DataAppearanceClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 개인 인벤토리 (GROMO-1783). 멱등 GET 이라 재시도한다 — 목록과 equipped 는 Data 가 한
     * 스냅샷으로 돌려준다.
     */
    public PersonalInventory fetchMyInventory(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_MY_INVENTORY, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<PersonalInventory>() { });
    }

    /**
     * 개인 외양 적용 (GROMO-1783). {@code fields}·{@code values} 는 공개 본문의 tri-state 를
     * 그대로 옮긴 캐리어다 — 명시 null 이 해제 의미라 필드 제거로 바꾸면 다른 명령이 된다.
     * 앱 키를 그대로 전달해 같은 키의 재시도는 Data 의 receipt 재생이다.
     */
    public PersonalAppearancePatchResult patchMyAppearance(UUID userId, List<String> fields,
            Map<String, Object> values, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, userPath(PATH_MY_APPEARANCE, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new AppearancePatchCommand(fields, values, null))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<PersonalAppearancePatchResult>() { });
    }

    /** 공동 인벤토리 (GROMO-1783). 활성 주민만 — 비주민 거절은 Data 의 MEMBER_ONLY 다. */
    public SharedInventory fetchIslandInventory(UUID islandId, UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_INVENTORY, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<SharedInventory>() { });
    }

    /**
     * 공동 외양 적용 (GROMO-1783). SHARED_APPEARANCE(방장) 전용이고 {@code expectedVersion} 은
     * 「사용자가 본 외양」의 동의 증거다 — 지문에 들어가 같은 키의 다른 본문은 재사용 거절이 된다.
     */
    public IslandAppearancePatchResult patchIslandAppearance(UUID islandId, UUID userId,
            List<String> fields, Map<String, Object> values, long expectedVersion, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, islandPath(PATH_ISLAND_APPEARANCE, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new AppearancePatchCommand(fields, values, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandAppearancePatchResult>() { });
    }

    /** 공용 음악 재생 상태 (GROMO-1779). 활성 주민 + 방송기 완공 — 멱등 GET 이라 재시도한다. */
    public PlaybackState fetchIslandPlayback(UUID islandId, UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_PLAYBACK, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<PlaybackState>() { });
    }

    /**
     * 공용 음악 재생 변경 (GROMO-1779). 외양과 같은 tri-state 캐리어 — 제출된 필드만 싣는다. 앱 키를
     * 그대로 전달해 같은 키의 재시도는 Data 의 receipt 재생이다.
     */
    public PlaybackPatchResult patchIslandPlayback(UUID islandId, UUID userId, List<String> fields,
            Map<String, Object> values, long expectedVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, islandPath(PATH_ISLAND_PLAYBACK, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new AppearancePatchCommand(fields, values, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<PlaybackPatchResult>() { });
    }

    /**
     * 외양 PATCH 요청 본문 (GROMO-1783). tri-state 캐리어 — {@code fields} 는 제출된 필드명,
     * {@code values} 는 그 원시 값(명시 null 보존)이다. {@code expectedVersion} 은 공동
     * PATCH 에만 채운다.
     */
    record AppearancePatchCommand(List<String> fields, Map<String, Object> values,
                                  Long expectedVersion) {
    }
}
