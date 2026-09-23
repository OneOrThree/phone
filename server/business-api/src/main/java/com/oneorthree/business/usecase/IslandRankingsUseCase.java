package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataRecordsClient;
import com.oneorthree.business.upstream.data.dto.IslandRankingViews;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 주간 섬 랭킹의 공개 유스케이스 (GROMO-1997, island-rankings LLD).
 *
 * <p>전망대·주민 판정과 집계·순위는 전부 Data 가 한다. 여기서는 공개 모양을 만들고 도메인 실패를 공개 오류 표로
 * 옮긴다. 표에 없는 (상태, 코드)는 그대로 올려 {@code registeredUpstream} 이 옮기거나 502 로 접는다.
 *
 * <p><b>커서를 발급하지 않는다.</b> 목록은 상위 {@value #MAX_LIMIT} 개까지이고 그 아래 순위는
 * {@code myRank} 로만 알려 준다 — 페이지가 없으면 「움직이는 집계를 페이지로 넘기다 행이 빠지거나 겹치는」
 * 문제 자체가 없다(LLD §4). 들어온 커서는 위조다(400). 회관 기록 scope=island 가 같은 결론을 택했다
 * (2026-09-19 결정 RC-P12-적용).
 */
@Service
@RequiredArgsConstructor
public class IslandRankingsUseCase {

    /** 공개 목록 상한 — Data 의 상한과 같다. 생략하면 Data 의 기본값(30)이다. */
    public static final int MAX_LIMIT = 100;

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            "USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null),
            // 현재 섬이 사라졌다 — 경로에 섬이 없으므로 field 도 없다.
            "GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, null),
            // 현재 섬이 없거나 그 섬의 활성 주민이 아니다.
            "MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null),
            "OBSERVATORY_LOCKED", new PublicFailure(403, ApiErrorCode.FACILITY_LOCKED, null),
            // 일요일이 아니거나 아직 오지 않은 주 — 형식은 Business 가 먼저 400 으로 거른다.
            "RANKING_WEEK_OUT_OF_RANGE", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "week"));

    private final DataRecordsClient data;

    /**
     * 섬 간 주간 랭킹.
     *
     * @param week  주 시작일(UTC 일요일). 달력 의미 판정은 Data 몫이다
     * @param limit 목록 크기. {@code null} 이면 Data 기본값
     */
    public IslandRankings islands(AccessTokenClaims claims, LocalDate week, Integer limit, Deadline deadline) {
        IslandRankingViews.IslandRankingPage view;
        try {
            view = data.fetchIslandRankings(claims.userId(), week, limit, deadline);
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
            if (failure == null || failure.upstreamStatus() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
        if (view == null || view.items() == null || view.asOf() == null
                || !week.toString().equals(view.week())) {
            throw new UpstreamContractMismatchException("섬 랭킹 응답이 요청과 다릅니다");
        }
        return new IslandRankings(view.items(), view.myRank(), null, view.asOf());
    }

    /** 상류 실패 한 줄 — 기대하는 상류 상태, 공개 코드, 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }

    /**
     * 공개 {@code data} — 원본 계약({@code items}·{@code nextCursor})에 승인된 {@code asOf} 와, 목록이 상위
     * N 개로 잘리므로 자기 섬 순위를 <b>전체 모집단</b> 기준으로 알려 주는 {@code myRank} 를 싣는다.
     * {@code nextCursor} 는 언제나 {@code null} 이다.
     */
    public record IslandRankings(List<IslandRankingViews.IslandRanking> items, Integer myRank, String nextCursor,
            String asOf) {
    }
}
