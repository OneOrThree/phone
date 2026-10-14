package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.IslandPromotions;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 잡지 홍보 신청·섬 소식(GROMO-2267, 섬 외부 계약 §7)과 고양이 잡지 편집·꾸미기 재료·신고·홍보 기록판(GROMO-2289)의
 * 공개 유스케이스.
 * 섬장·게스트·잔액·신청 창·호당 1회·layout·재료 보유는 전부 Data 가 판정하고 여기서는 코드만 옮긴다. 상태까지
 * 대조해 Data 가 같은 코드의 상태를 바꾸면 502 로 드러난다.
 */
@Service
@RequiredArgsConstructor
public class IslandPromotionUseCase {

    /**
     * 상류 (status, code) → 공개 코드·필드. {@code SOCIAL_LOGIN_REQUIRED}·{@code PROMOTION_ALREADY_REQUESTED_TODAY}
     * ·{@code BANNED_WORD} 와 GROMO-2289 의 {@code PROMOTION_*} 7종은 동명 {@link ApiErrorCode} 라 여기 없이 전역
     * 핸들러가 옮긴다(멱등 키 충돌·처리 중도 마찬가지).
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            "USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null),
            "GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, "islandId"),
            // 섬장이 아닌 신청 — 일반 주민·방문자 모두.
            "NOT_OWNER", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null),
            // 소식·홍보 기록판은 주민만 읽는다.
            "MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "islandId"),
            // 지금 주민인 섬의 홍보 칸 신고 — 앱은 우리 섬 칸에 신고 버튼을 두지 않으므로 공개 이름을 따로 만들지 않는다.
            "PROMOTION_REPORT_OWN_ISLAND", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null),
            // 섬 통장이 홍보비(60)보다 적다 — 차감 0, 소식 0.
            "INSUFFICIENT_FUNDS", new PublicFailure(409, ApiErrorCode.INSUFFICIENT_FUNDS, null),
            // 잡지 기능 스위치가 꺼져 있다(GROMO-2289) — 신청·고치기 모두. 공개 이름은 만들지 않는다.
            "MAGAZINE_NOT_READY", new PublicFailure(503, ApiErrorCode.SERVICE_UNAVAILABLE, null));

    private final DataIslandClient data;

    /** 신청. 같은 키·같은 요청은 Data 의 원 201 재생이다. */
    public IslandPromotions.Created promote(AccessTokenClaims claims, UUID islandId, String body, JsonNode layout,
            UUID key, Deadline deadline) {
        return required(relay(() -> data.requestPromotion(claims.userId(), islandId, body, layout, key, deadline)));
    }

    /** 고치기 — 다음 호에 낸 홍보를 자정 전까지 전체 교체한다. */
    public IslandPromotions.Updated update(AccessTokenClaims claims, UUID islandId, UUID promotionId, String body,
            JsonNode layout, Deadline deadline) {
        return required(relay(() -> data.updatePromotion(claims.userId(), islandId, promotionId, body, layout,
                deadline)));
    }

    public IslandPromotions.Editor editor(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        return required(relay(() -> data.fetchPromotionEditor(claims.userId(), islandId, deadline)));
    }

    public IslandPromotions.Assets assets(AccessTokenClaims claims, Deadline deadline) {
        return required(relay(() -> data.fetchMagazineAssets(claims.userId(), deadline)));
    }

    /**
     * 홍보 칸 신고 — 소셜 로그인·없는 홍보·우리 섬 칸(403 {@code FORBIDDEN})·중복 신고·3회 숨김은 전부 Data 가 판정한다. Data 가 {@code reported:true} 가
     * 아닌 성공을 주면 계약 위반이다.
     */
    public IslandPromotions.Report report(AccessTokenClaims claims, UUID islandId, UUID promotionId, String reason,
            Deadline deadline) {
        IslandPromotions.Report report = required(relay(() -> data.reportPromotion(claims.userId(), islandId,
                promotionId, reason, deadline)));
        if (!report.reported()) {
            throw new UpstreamContractMismatchException("홍보 신고 응답이 계약과 다릅니다");
        }
        return report;
    }

    /** 우리 섬 홍보 기록판 — 주민만 읽는다(비주민은 Data 의 {@code MEMBER_ONLY} → 공개 403 {@code FORBIDDEN}). */
    public IslandPromotions.RecordPage records(AccessTokenClaims claims, UUID islandId, int limit,
            Deadline deadline) {
        return required(relay(() -> data.fetchPromotionRecords(claims.userId(), islandId, limit, deadline)));
    }

    public IslandPromotions.NewsPage news(AccessTokenClaims claims, UUID islandId, int limit, Deadline deadline) {
        return required(relay(() -> data.fetchIslandNews(claims.userId(), islandId, limit, deadline)));
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("섬 소식·홍보 응답이 없습니다");
        }
        return value;
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            if (failure == null || failure.upstreamStatus() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 상류 (status, code) 한 쌍 → 공개 코드와 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }
}
