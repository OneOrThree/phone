package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.IslandFocusMembers;
import com.oneorthree.business.upstream.data.dto.IslandRestMembers;
import com.oneorthree.business.upstream.data.dto.MemberWatermark;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 같이 낚시 초기 스냅샷 2종의 공개 유스케이스 (GROMO-1765, focus-rest-session LLD §2).
 *
 * <p>소속·목록·watermark 는 전부 Data 가 한 스냅샷에서 판정한다 — Business 는 세션 주체만 넘기고 도메인
 * 실패를 공개 오류로 옮긴다. 표에 없는 판정은 그대로 올려 502 로 접힌다({@code IslandConstructionUseCase} 와 같다).
 */
@Service
@RequiredArgsConstructor
public class IslandFocusMembersUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            "USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null),
            // 비주민·없는 섬·종료된 섬 — Data 가 섬 존재를 흘리지 않도록 한 코드로 합쳐 둔 것을 그대로 옮긴다.
            "MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId"));

    private final DataIslandClient data;

    public FocusMembersView focusMembers(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandFocusMembers members = relay(() -> data.fetchFocusMembers(claims.userId(), islandId, deadline));
        if (members == null) {
            throw new UpstreamContractMismatchException("집중 주민 응답이 없습니다");
        }
        return new FocusMembersView(members.items().stream().map(FocusMemberView::from).toList(),
                members.serverNow(), members.watermarks().stream().map(MemberWatermarkView::from).toList());
    }

    public RestMembersView restMembers(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandRestMembers members = relay(() -> data.fetchRestMembers(claims.userId(), islandId, deadline));
        if (members == null) {
            throw new UpstreamContractMismatchException("휴식 주민 응답이 없습니다");
        }
        return new RestMembersView(members.items().stream().map(RestMemberView::from).toList(),
                members.serverNow(), members.watermarks().stream().map(MemberWatermarkView::from).toList());
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            // 상태까지 대조한다 — 같은 코드의 상태가 바뀌면 공개 표가 조용히 어긋나는 대신 502 가 된다.
            if (failure == null || failure.code().getStatus().value() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 공개 스냅샷은 주민과 watermark까지 내부 전송 DTO와 분리한다. */
    public record FocusMembersView(
            @JsonProperty(required = true) List<FocusMemberView> items,
            @JsonProperty(required = true) String serverNow,
            @JsonProperty(required = true) List<MemberWatermarkView> watermarks) {
    }

    public record RestMembersView(
            @JsonProperty(required = true) List<RestMemberView> items,
            @JsonProperty(required = true) String serverNow,
            @JsonProperty(required = true) List<MemberWatermarkView> watermarks) {
    }

    public record FocusMemberView(
            @JsonProperty(required = true) String userId,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) String sessionId,
            @JsonProperty(required = true) String subject,
            @JsonProperty(required = true) long activeSeconds,
            @JsonProperty(required = true) String status) {
        private static FocusMemberView from(IslandFocusMembers.Item item) {
            return item == null ? null : new FocusMemberView(item.userId(), item.name(), item.sessionId(),
                    item.subject(), item.activeSeconds(), item.status());
        }
    }

    public record RestMemberView(
            @JsonProperty(required = true) String userId,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) int restSeat,
            @JsonProperty(required = true) String restStartedAt) {
        private static RestMemberView from(IslandRestMembers.Item item) {
            return item == null ? null : new RestMemberView(item.userId(), item.name(), item.restSeat(),
                    item.restStartedAt());
        }
    }

    public record MemberWatermarkView(
            @JsonProperty(required = true) String projection,
            @JsonProperty(required = true) String islandId,
            @JsonProperty(required = true) String aggregateId,
            @JsonProperty(required = true) long version) {
        private static MemberWatermarkView from(MemberWatermark watermark) {
            return watermark == null ? null : new MemberWatermarkView(watermark.projection(), watermark.islandId(),
                    watermark.aggregateId(), watermark.version());
        }
    }

    private record PublicFailure(ApiErrorCode code, String field) {
    }
}
