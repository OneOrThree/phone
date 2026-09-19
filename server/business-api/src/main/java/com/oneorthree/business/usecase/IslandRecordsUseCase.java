package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.IslandRecordViews;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 회관 기록(도서관) 통계 3종의 공개 유스케이스 (GROMO-1769, island-records LLD).
 *
 * <p>주민·도서관·세션·기기 판정과 집계는 전부 Data 가 한다. 여기서는 scope 별 공개 모양을 만들고, 집중 scope=me
 * 다음 페이지의 스냅샷 경계를 서명 커서로 감싸고, 도메인 실패를 공개 오류 표로 옮긴다. 표에 없는 (상태, 코드)는
 * 그대로 올려 {@code registeredUpstream} 이 동명 공개 코드로 옮기거나 502 로 접는다.
 *
 * <p>scope=island 는 섬 정원(최대 15)이 페이지(30)보다 작아 커서를 발급하지 않는다 — 들어온 커서는 위조다(400).
 */
@Service
@RequiredArgsConstructor
public class IslandRecordsUseCase {

    public static final String SCOPE_ME = "me";
    public static final String SCOPE_ISLAND = "island";
    private static final String RESOURCE_FOCUS = "island-focus-statistics";
    private static final String SORT_COMPLETED_DESC = "completed-desc";
    /** Data 의 scope=me 페이지 크기와 같다 — 커서 지문에 묶는다. */
    private static final int PAGE_SIZE = 30;

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            Map.entry("MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("LIBRARY_LOCKED", new PublicFailure(403, ApiErrorCode.FACILITY_LOCKED, null)),
            Map.entry("STATISTICS_SNAPSHOT_EXPIRED", new PublicFailure(409, ApiErrorCode.CURSOR_EXPIRED, "cursor")),
            // 로그아웃·세대 교체된 세션 — 계정 유스케이스와 같이 공개 401 이다.
            Map.entry("SESSION_NOT_ACTIVE", new PublicFailure(403, ApiErrorCode.UNAUTHORIZED, null)),
            Map.entry("SCREEN_TIME_DEVICE_FORBIDDEN", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "deviceId")),
            Map.entry("SCREEN_TIME_MEASUREMENT_CONFLICT",
                    new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, "measuredAt")),
            Map.entry("SCREEN_TIME_OUT_OF_WINDOW", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "measuredAt")),
            Map.entry("STATISTICS_SCOPE_OUT_OF_RANGE", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "scope")),
            Map.entry("SCREEN_TIME_INVALID_MEASUREMENT",
                    new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "measurementStatus")));

    private final DataApiClient data;
    private final ObjectProvider<SignedCursorCodec> cursorCodecs;

    /** 집중 통계 — scope=me 는 {@link MeFocus}, scope=island 는 {@link IslandFocus}. */
    public Object focus(AccessTokenClaims claims, UUID islandId, LocalDate from, LocalDate to, String scope,
            String cursor, Deadline deadline) {
        boolean me = SCOPE_ME.equals(scope);
        if (!me && cursor != null) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
        CursorScope cursorScope = new CursorScope(claims.userId(), RESOURCE_FOCUS, Map.of(
                "islandId", islandId.toString(), "from", from.toString(), "to", to.toString()),
                SORT_COMPLETED_DESC, PAGE_SIZE);
        CursorBoundary boundary = me ? codec().decode(cursor, cursorScope) : null;
        UUID snapshotId = boundary == null ? null : snapshotId(boundary.sortKey());
        Integer offset = boundary == null ? null : offset(boundary.tieBreaker());
        IslandRecordViews.FocusStatistics view = relay(() -> data.fetchFocusStatistics(claims.userId(), islandId,
                from, to, scope, snapshotId, offset, deadline));
        if (view == null || !scope.equals(view.scope()) || view.asOf() == null) {
            throw new UpstreamContractMismatchException("집중 통계 응답이 요청과 다릅니다");
        }
        if (!me) {
            if (view.members() == null) {
                throw new UpstreamContractMismatchException("집중 통계 주민 목록이 없습니다");
            }
            return new IslandFocus(SCOPE_ISLAND, view.members(), null, view.asOf());
        }
        if (view.totalSeconds() == null || view.series() == null || view.records() == null
                || (view.nextSnapshotId() == null) != (view.nextOffset() == null)) {
            throw new UpstreamContractMismatchException("집중 통계 응답이 완전하지 않습니다");
        }
        String next = view.nextSnapshotId() == null ? null : codec().encode(cursorScope,
                new CursorBoundary(view.nextSnapshotId(), view.nextOffset().toString()));
        return new MeFocus(SCOPE_ME, view.totalSeconds(), view.series(), view.records(), next, view.asOf());
    }

    /** 스크린타임 통계 — scope=me 는 {@link MeScreenTime}, scope=island 는 {@link IslandScreenTime}. */
    public Object screenTime(AccessTokenClaims claims, UUID islandId, LocalDate from, LocalDate to, String scope,
            Deadline deadline) {
        IslandRecordViews.ScreenTimeStatistics view = relay(() -> data.fetchScreenTimeStatistics(claims.userId(),
                islandId, from, to, scope, deadline));
        if (view == null || !scope.equals(view.scope())) {
            throw new UpstreamContractMismatchException("스크린타임 통계 응답이 요청과 다릅니다");
        }
        if (SCOPE_ISLAND.equals(scope)) {
            if (view.members() == null) {
                throw new UpstreamContractMismatchException("스크린타임 통계 주민 목록이 없습니다");
            }
            return new IslandScreenTime(SCOPE_ISLAND, view.members());
        }
        if (view.measurementStatus() == null || view.series() == null) {
            throw new UpstreamContractMismatchException("스크린타임 통계 응답이 완전하지 않습니다");
        }
        return new MeScreenTime(SCOPE_ME, view.measurementStatus(), view.totalMinutes(), view.series(),
                view.updatedAt());
    }

    /** 기기 측정 PUT — 응답은 그 기기·날짜의 최신 선택 관측이다. */
    public IslandRecordViews.ScreenTimeDay putScreenTime(AccessTokenClaims claims, LocalDate date,
            Map<String, Object> body, UUID key, Deadline deadline) {
        IslandRecordViews.ScreenTimeDay day = relay(() -> data.putScreenTime(claims.userId(), claims.sessionId(),
                claims.authGeneration(), date, body, key, deadline));
        if (day == null || !date.toString().equals(day.date()) || day.measurementStatus() == null
                || ("authorized".equals(day.measurementStatus()) == (day.minutes() == null))) {
            throw new UpstreamContractMismatchException("스크린타임 측정 응답이 계약과 다릅니다");
        }
        return day;
    }

    /** 커서 서명기 — 없으면 첫 페이지로 접지 않고 503 이다(다른 목록 유스케이스와 같은 이유). */
    private SignedCursorCodec codec() {
        SignedCursorCodec codec = cursorCodecs.getIfAvailable();
        if (codec == null) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        return codec;
    }

    /** 서명은 통과했어도 경계 값 자체는 다시 검증한다. */
    private static UUID snapshotId(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
    }

    private static Integer offset(String value) {
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < 1) {
                throw new NumberFormatException("offset");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
            if (failure == null || failure.upstreamStatus() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 상류 실패 한 줄 — 기대하는 상류 상태, 공개 코드, 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }

    /** 집중 scope=me — 본인 전체 기간 합·일별과 완료 세션 페이지(LLD §2). */
    public record MeFocus(String scope, long totalSeconds, List<IslandRecordViews.DaySeconds> series,
            List<IslandRecordViews.FocusRecord> records, String nextCursor, String asOf) {
    }

    /** 집중 scope=island — 주민별 이 섬 기여. 개인 기록·과목 없음. */
    public record IslandFocus(String scope, List<IslandRecordViews.FocusMember> members, String nextCursor,
            String asOf) {
    }

    /** 스크린타임 scope=me. */
    public record MeScreenTime(String scope, String measurementStatus, Integer totalMinutes,
            List<IslandRecordViews.ScreenDay> series, String updatedAt) {
    }

    /** 스크린타임 scope=island. */
    public record IslandScreenTime(String scope, List<IslandRecordViews.ScreenMember> members) {
    }
}
