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
import com.oneorthree.business.upstream.data.DataRecordsClient;
import com.oneorthree.business.upstream.data.dto.IslandFishEarnings;
import com.oneorthree.business.upstream.data.dto.IslandLedger;
import com.oneorthree.business.upstream.data.dto.IslandRecordViews;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 회관 기록의 공개 유스케이스 — 도서관 통계 3종(GROMO-1769, island-records LLD)과 공동 가계부
 * (GROMO-1786/1895, island-construction LLD §6). 둘 다 회관에서 읽고 같은 커서 서명기·실패 표를 쓴다.
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
    /** 가계부 한 쪽의 크기 — 서버 내부 값이라 공개 query 에 limit 을 두지 않는다(다른 목록과 같다). */
    public static final int LEDGER_PAGE_SIZE = 30;
    private static final String RESOURCE_FOCUS = "island-focus-statistics";
    private static final String RESOURCE_LEDGER = "island-resources-ledger";
    private static final String SORT_COMPLETED_DESC = "completed-desc";
    private static final String SORT_CREATED_DESC = "created-desc";
    private static final String FIELD_CURSOR = "cursor";
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

    private final DataRecordsClient data;
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

    /**
     * 섬 공동 가계부 한 쪽 (GROMO-1786, island-construction LLD §6) — 최신순 {@code (createdAt, id)} keyset.
     *
     * <p>주민 판정은 Data 몫이다 — 방문자(비주민)는 {@code MEMBER_ONLY} 가 올라와 403 {@code FORBIDDEN} 이 된다.
     * 상류가 실패하면 빈 장부를 만들지 않고 그대로 실패한다: {@code items:[]} 는 「그 달에 거래가 없다」는 뜻이라
     * 「못 읽었다」와 같은 값으로 접으면 안 된다.
     *
     * <p>커서 scope 에 섬·월·방향이 묶이므로 다른 달·다른 방향의 커서는 400 이다 — 필터가 바뀌면 keyset 축의
     * 의미도 바뀌기 때문이다. 페이지 크기는 서버 내부 값({@link #LEDGER_PAGE_SIZE})이라 공개 query 에 없다.
     *
     * @param month {@code YYYY-MM} (KST 달력 월), {@code direction} 은 {@code earn|spend} 또는 {@code null}
     */
    public Ledger ledger(AccessTokenClaims claims, UUID islandId, String month, String direction, String cursor,
            Deadline deadline) {
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("islandId", islandId.toString());
        filters.put("month", month);
        filters.put("direction", direction == null ? "" : direction);
        CursorScope scope = new CursorScope(claims.userId(), RESOURCE_LEDGER, filters, SORT_CREATED_DESC,
                LEDGER_PAGE_SIZE);
        Anchor anchor = Anchor.of(codec().decode(cursor, scope, FIELD_CURSOR));
        IslandLedger page = relay(() -> data.fetchIslandLedger(claims.userId(), islandId, month, direction,
                anchor == null ? null : anchor.createdAt(), anchor == null ? null : anchor.id(),
                LEDGER_PAGE_SIZE, deadline));
        if (page == null || !month.equals(page.month()) || page.items() == null
                || (page.nextCreatedAt() == null) != (page.nextEntryId() == null)) {
            throw new UpstreamContractMismatchException("가계부 응답이 요청과 다릅니다");
        }
        String next = page.nextCreatedAt() == null ? null : codec().encode(scope,
                new CursorBoundary(page.nextCreatedAt().toString(), page.nextEntryId().toString()));
        return new Ledger(page.month(), page.earnedTotal(), page.spentTotal(), page.items(), next);
    }

    /**
     * 도서관 물고기 장 — 주민별 누적 획득 (GROMO-1895/2046, island-records LLD §7).
     *
     * <p>게이트가 둘이고 <b>권한이 시설보다 먼저</b>다(Data 가 그 순서로 판정한다): 비주민·떠난 주민은
     * {@code MEMBER_ONLY} → 403 {@code FORBIDDEN} 이고, 주민이어도 도서관이 미완공이면
     * {@code LIBRARY_LOCKED} → 403 {@code FACILITY_LOCKED} 다. 둘 다 이미 {@link #DOMAIN_FAILURES} 에
     * 있어 실패 표를 늘리지 않는다 — 다만 <b>공개 표를 거치는지</b>가 이 조회의 계약이라 계약 테스트가 그 두 쌍을
     * 직접 본다(표에 없으면 502 {@code UPSTREAM_CONTRACT_ERROR} 로 새 나간다).
     *
     * <p>실패를 <b>빈 명단으로 접지 않는다</b> — {@code members:[]} 는 「아무도 안 낚았다」는 뜻이라
     * 「못 읽었다」·「볼 권한이 없다」와 같은 값으로 접으면 정책 「주민 개인 기록은 방문자에게 보여 주지 않는다」가
     * 조용히 뚫린다.
     */
    public IslandFishEarnings fishEarnings(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandFishEarnings view = relay(() -> data.fetchFishEarnings(claims.userId(), islandId, deadline));
        if (view == null || view.members() == null
                || view.members().stream().anyMatch(member -> member.userId() == null
                        || member.earnedFish() == null)) {
            // 빠진 마리 수를 0 으로 지어내지 않는다 — 「안 낚았다」와 「모른다」는 다른 값이다.
            throw new UpstreamContractMismatchException("물고기 장 응답이 완전하지 않습니다");
        }
        return view;
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

    /** 서명 커서가 담은 keyset 경계 — 서명은 통과했는데 값이 형식에 맞지 않으면 위조·손상이다(같은 400). */
    private record Anchor(Instant createdAt, UUID id) {

        static Anchor of(CursorBoundary boundary) {
            if (boundary == null) {
                return null;
            }
            try {
                return new Anchor(Instant.parse(boundary.sortKey()), UUID.fromString(boundary.tieBreaker()));
            } catch (DateTimeParseException | IllegalArgumentException e) {
                throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, FIELD_CURSOR);
            }
        }
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

    /**
     * 공동 가계부 한 쪽 — 그 달 전체의 적립·지출 합과 최신순 줄, 다음 쪽 서명 커서.
     *
     * <p>현재 섬 잔액은 여기 없다 — 같은 화면의 {@code wallets} 조각이 정본이다(GROMO-1781). 줄마다 이월
     * 잔액을 붙이지 않는 이유도 같다: 집중 적립이 하루로 접혀 있어 줄 단위 잔액이 원장의 실제 순간과 어긋난다.
     */
    public record Ledger(String month, long earnedTotal, long spentTotal, List<IslandLedger.Entry> items,
            String nextCursor) {
    }
}
