package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.ConstructionOptions;
import com.oneorthree.business.upstream.data.dto.ConstructionResult;
import com.oneorthree.business.upstream.data.dto.ConstructionTarget;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.islandPath;

/** 섬 건설 3종의 Data 호출 (GROMO-1767) — 공개 경로와 이름이 같다. */
public class DataConstructionClient {

    private static final String PATH_CONSTRUCTION_OPTIONS = "/internal/islands/{islandId}/construction-options";
    private static final String PATH_CONSTRUCTION_TARGET = "/internal/islands/{islandId}/construction-target";
    private static final String PATH_CONSTRUCTIONS = "/internal/islands/{islandId}/constructions";

    private final InternalHttpClient http;

    public DataConstructionClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 건설 옵션 스냅샷 (GROMO-1767). 멱등 GET 이라 재시도한다. selectable/buildable 판정과
     * 권한 거절은 전부 상류 몫이다 — 주체는 {@code onBehalfOf} 로만 전달한다.
     */
    public ConstructionOptions fetchConstructionOptions(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_CONSTRUCTION_OPTIONS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<ConstructionOptions>() { });
    }

    /**
     * 건설 목표 선택 (GROMO-1767). 차감이 없는 선택 명령이라 costPolicyVersion·잔액을 요구하지
     * 않는다(C03). 전체 교체 PUT 이라 멱등이고 앱 키를 그대로 전달한다.
     */
    public ConstructionTarget selectConstructionTarget(UUID userId, UUID islandId, String buildingId,
            long expectedVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT, islandPath(PATH_CONSTRUCTION_TARGET, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new ConstructionTargetCommand(buildingId, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ConstructionTarget>() { });
    }

    /**
     * 건설 시작 (GROMO-1767). {@code expectedCostPolicyVersion} 은 «사용자가 본 가격»의 동의
     * 증거다 — 가격만 바뀌어도 상류가 409 로 거절한다(C10). 응답 유실 복구는 같은 키 재생이다.
     */
    public ConstructionResult startConstruction(UUID userId, UUID islandId, String buildingId,
            long expectedVersion, long expectedCostPolicyVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_CONSTRUCTIONS, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new ConstructionStartCommand(buildingId, expectedVersion,
                                expectedCostPolicyVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ConstructionResult>() { });
    }

    /** 건설 목표 선택 요청 본문 (GROMO-1767). 잔액·가격 동의를 요구하지 않는다(C03). */
    record ConstructionTargetCommand(String buildingId, long expectedVersion) {
    }

    record ConstructionStartCommand(String buildingId, long expectedVersion, long expectedCostPolicyVersion) {
    }
}
