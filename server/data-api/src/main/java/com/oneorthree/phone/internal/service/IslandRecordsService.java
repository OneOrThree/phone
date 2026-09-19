package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusStatisticsSnapshotRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusStatisticsSnapshot;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.dto.IslandRecordViews.DaySeconds;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusMember;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusRecord;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusSnapshot;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusStatistics;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenDay;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenMember;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenTimeDay;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenTimeStatistics;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenTimeUpload;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.screentime.repository.ScreenTimeObservationRepository;
import com.oneorthree.phone.screentime.repository.domain.ScreenTimeObservation;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 회관 기록(도서관) 통계 3종 (GROMO-1769, island-records LLD) — 집중 통계·스크린타임 통계 조회와 기기 측정 PUT.
 *
 * <p><b>날짜 축은 UTC 다</b>(2026-09-19 결정 RC-축 — 섬 퀘스트 Q-6 과 같은 신규 기능 규칙). 요청 기간은
 * {@code [from 00:00Z, to+1 00:00Z)} 이고 측정 날짜도 UTC 버킷이다. KST 라벨인 legacy 스크린타임 표는 읽지 않는다.
 *
 * <p>두 GET 은 살아 있는 섬의 활성 주민이면서 도서관이 완공된 섬에서만 연다(bff-screens B23 — 기록은 도서관).
 * PUT 은 도서관과 무관한 본인 명령이다(PRD — 회관이 없다고 기기 원본 저장을 막지 않는다). PUT 은 보상·퀘스트
 * 진행을 만들지 않는다(RC-P11 — 스크린 퀘스트는 UTC 전환 전 생성 불가, 결정 Q-6).
 *
 * <p>집중·소속·시설·세션·명령 receipt 를 함께 읽는 조합이라 L10 internal 에 둔다.
 */
@Service
@RequiredArgsConstructor
public class IslandRecordsService {

    public static final String SCOPE_ME = "me";
    public static final String SCOPE_ISLAND = "island";
    /** 조회 기간 상한(양끝 포함) — 주·월 화면을 모두 담는다(LLD §2). */
    public static final int MAX_DAYS = 31;
    /** scope=me 기록 한 페이지 — A0 기본값. 섬 정원(최대 15)이 이보다 작아 scope=island 는 페이지가 없다. */
    static final int PAGE_SIZE = 30;
    private static final Duration SNAPSHOT_TTL = Duration.ofMinutes(15);
    private static final ZoneOffset UTC = ZoneOffset.UTC;
    /** 집중 기록에 넣는 세션 — 진행 중과 정상 완료. 정산 없이 끝난 세션(ABANDONED·MEMBERSHIP_LOST)은 뺀다. */
    private static final List<FocusSessionLifecycle> COUNTED = List.of(FocusSessionLifecycle.ACTIVE,
            FocusSessionLifecycle.PAUSED, FocusSessionLifecycle.COMPLETED);
    private static final String AUTHORIZED = "authorized";
    private static final String DENIED = "denied";
    private static final String UNAVAILABLE = "unavailable";
    /** PostgreSQL uuid 순서(부호 없는 바이트)와 같다 — 소문자 16진 문자열 비교. */
    private static final Comparator<UUID> UUID_ORDER = Comparator.comparing(UUID::toString);

    private final UserQueryService users;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final IslandFacilityQueryService facilities;
    private final FocusSessionDetailRepository details;
    private final FocusSessionIntervalRepository intervals;
    private final FocusStatisticsSnapshotRepository snapshots;
    private final ScreenTimeObservationRepository observations;
    private final AuthSessionService sessions;
    private final PublicCommandService publicCommands;
    private final Clock clock;

    /** 관측 시각이 서버 시각보다 앞서도 받는 폭(RC-D04 — 설정값이 곧 정책 revision). */
    @Value("${island-records.screen-time.future-tolerance:PT1M}")
    private Duration futureTolerance;

    /**
     * 날짜가 끝난 뒤 보고를 받는 유예(RC-D04). 기본 12시간 = 다음 날 12:00 UTC 로 섬 퀘스트 screen 판정 유예(결정 Q-5)와
     * 같다 — 판정 뒤에 값이 바뀌는 「마감 후 정정」을 만들지 않는다.
     */
    @Value("${island-records.screen-time.report-grace:PT12H}")
    private Duration reportGrace;

    // ------------------------------------------------------------------ 집중

    /**
     * 집중 통계. scope=me 는 <b>개인 전체</b>(섬 무관), scope=island 는 현재 주민별 <b>이 섬에 귀속된</b>(세션 시작 때
     * 고정한 섬) 기여다(2026-09-19 결정 RC-D01). 합계·일별은 페이지와 무관한 전체 기간 값이다(RC-P04).
     *
     * <p>한 스냅샷에서 읽도록 REPEATABLE READ 다 — 상세와 구간을 두 SELECT 로 읽는 사이 finish 가 커밋돼도 같은 순간을 본다.
     *
     * @param snapshotId 다음 페이지면 첫 페이지가 고정한 스냅샷(me 만), 첫 페이지면 {@code null}
     * @param offset     다음 페이지의 시작 위치
     */
    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public FocusStatistics focus(UUID userId, UUID islandId, LocalDate from, LocalDate to, String scope,
                                 UUID snapshotId, Integer offset) {
        requireRange(from, to);
        Group island = requireLibraryResident(userId, islandId);
        Instant start = from.atStartOfDay(UTC).toInstant();
        Instant end = to.plusDays(1).atStartOfDay(UTC).toInstant();
        if (SCOPE_ISLAND.equals(scope)) {
            if (snapshotId != null) {
                throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
            }
            return islandFocus(island, from, to, start, end);
        }
        requireMe(scope);
        if (snapshotId != null) {
            return page(snapshotId, readSnapshot(userId, snapshotId), offset);
        }
        Instant asOf = clock.instant();
        TreeMap<LocalDate, Long> series = new TreeMap<>();
        List<FocusRecord> records = new ArrayList<>();
        for (Contribution contribution : contributions(details.findOverlapping(List.of(userId), COUNTED, start, end),
                from, to, asOf)) {
            contribution.byDate().forEach((date, seconds) -> series.merge(date, seconds.longValue(), Long::sum));
            FocusSessionDetail session = contribution.session();
            if (session.getLifecycle() == FocusSessionLifecycle.COMPLETED && contribution.total() > 0) {
                records.add(new FocusRecord(session.getSessionId(), session.getSubject(), contribution.total(),
                        session.getLastTransitionAt()));
            }
        }
        records.sort(Comparator.comparing(FocusRecord::completedAt)
                .thenComparing(FocusRecord::id, UUID_ORDER).reversed());
        FocusSnapshot snapshot = new FocusSnapshot(asOf, sum(series), days(series), records);
        if (records.size() <= PAGE_SIZE) {
            return page(null, snapshot, 0);
        }
        // ponytail: 만료 스냅샷은 같은 사용자의 다음 생성 때 지운다 — 쌓임이 문제되면 정리 스케줄러로 옮긴다.
        snapshots.deleteExpiredOf(userId, asOf);
        UUID id = UUID.randomUUID();
        snapshots.save(FocusStatisticsSnapshot.builder().id(id).userId(userId)
                .payload(OutboxEnvelopeCodec.toJson(snapshot)).expiresAt(asOf.plus(SNAPSHOT_TTL)).build());
        return page(id, snapshot, 0);
    }

    private FocusStatistics islandFocus(Group island, LocalDate from, LocalDate to, Instant start, Instant end) {
        Instant asOf = clock.instant();
        List<User> residents = residents(island);
        Map<UUID, TreeMap<LocalDate, Long>> byUser = new LinkedHashMap<>();
        for (Contribution contribution : contributions(details.findOverlappingOnIsland(island.getId(),
                residents.stream().map(User::getId).toList(), COUNTED, start, end), from, to, asOf)) {
            TreeMap<LocalDate, Long> series = byUser.computeIfAbsent(contribution.session().getUserId(),
                    ignored -> new TreeMap<>());
            contribution.byDate().forEach((date, seconds) -> series.merge(date, seconds.longValue(), Long::sum));
        }
        List<FocusMember> result = residents.stream().map(user -> {
            TreeMap<LocalDate, Long> series = byUser.getOrDefault(user.getId(), new TreeMap<>());
            return new FocusMember(user.getId(), user.getNickname(), null, sum(series), days(series));
        }).toList();
        return new FocusStatistics(SCOPE_ISLAND, null, null, null, result, asOf, null, null);
    }

    /**
     * 세션마다 <b>세션 전체의 정본 날짜 기여</b>를 먼저 만들고 요청 날짜를 고른다 — 요청 구간부터 반올림하면 같은
     * 날짜가 주/월 화면에서 달라진다(LLD §3). 진행 중 세션의 열린 구간은 {@code asOf} 로 임시로 닫는다.
     */
    private List<Contribution> contributions(List<FocusSessionDetail> found, LocalDate from, LocalDate to,
                                             Instant asOf) {
        if (found.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<FocusSessionInterval>> bySession = intervals.findBySessionIdInOrderByOrdinalAsc(
                        found.stream().map(FocusSessionDetail::getSessionId).toList()).stream()
                .collect(Collectors.groupingBy(FocusSessionInterval::getSessionId));
        return found.stream().map(session -> {
            NavigableMap<LocalDate, Integer> byDate = FocusIntervalMath.activeSecondsByDate(
                    bySession.getOrDefault(session.getSessionId(), List.of()), UTC, asOf).subMap(from, true, to, true);
            long total = byDate.values().stream().mapToLong(Integer::longValue).sum();
            return new Contribution(session, byDate, total);
        }).toList();
    }

    private FocusSnapshot readSnapshot(UUID userId, UUID snapshotId) {
        FocusStatisticsSnapshot row = snapshots.findByIdAndUserIdAndExpiresAtAfter(snapshotId, userId,
                        clock.instant())
                .orElseThrow(() -> new StatsException(StatsErrorCode.STATISTICS_SNAPSHOT_EXPIRED));
        try {
            return OutboxEnvelopeCodec.fromJson(row.getPayload(), FocusSnapshot.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("집중 기록 스냅샷을 읽을 수 없습니다", e);
        }
    }

    private static FocusStatistics page(UUID snapshotId, FocusSnapshot snapshot, Integer offset) {
        List<FocusRecord> records = snapshot.records();
        if (offset == null || offset < 0 || (offset > 0 && offset >= records.size())) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        int next = offset + PAGE_SIZE;
        boolean more = next < records.size();
        return new FocusStatistics(SCOPE_ME, snapshot.totalSeconds(), snapshot.series(),
                records.subList(offset, Math.min(next, records.size())), null, snapshot.asOf(),
                more ? snapshotId : null, more ? next : null);
    }

    // ------------------------------------------------------------------ 스크린타임 조회

    /**
     * 스크린타임 통계. 날짜마다 기기별 최신 관측을 고르고 기간 상태를 정한다 — 규칙은 {@link #summarize}.
     * 섬 주민의 값은 개인 측정이라 섬 귀속이 없다. 기기 목록·deviceId 는 싣지 않는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ScreenTimeStatistics screenTime(UUID userId, UUID islandId, LocalDate from, LocalDate to, String scope) {
        requireRange(from, to);
        Group island = requireLibraryResident(userId, islandId);
        LocalDate today = LocalDate.ofInstant(clock.instant(), UTC);
        if (SCOPE_ISLAND.equals(scope)) {
            List<User> residents = residents(island);
            Map<UUID, List<ScreenTimeObservation>> byUser = observations.findByUserIdInAndMeasuredDateBetween(
                            residents.stream().map(User::getId).toList(), from, to).stream()
                    .collect(Collectors.groupingBy(ScreenTimeObservation::getUserId));
            return new ScreenTimeStatistics(SCOPE_ISLAND, null, null, null, null, residents.stream().map(user -> {
                Summary summary = summarize(byUser.getOrDefault(user.getId(), List.of()), from, to, today);
                return new ScreenMember(user.getId(), user.getNickname(), null, summary.total(), summary.status(),
                        summary.series(), summary.updatedAt());
            }).toList());
        }
        requireMe(scope);
        Summary summary = summarize(observations.findByUserIdInAndMeasuredDateBetween(List.of(userId), from, to),
                from, to, today);
        return new ScreenTimeStatistics(SCOPE_ME, summary.status(), summary.total(), summary.series(),
                summary.updatedAt(), null);
    }

    /**
     * 한 사람의 기간 측정 — 2026-09-19 결정(RC-D02 병합 보류 · RC-D03 권장안)의 규칙 그대로다.
     *
     * <ul>
     *   <li>날짜마다 기기별 최신 관측. 기기가 하나면 그 값, <b>둘 이상이면 병합 규칙이 없어</b>
     *       {@code minutes=null, unavailable} — 더하지도(중복) 하나를 고르지도(누락) 않는다.</li>
     *   <li>측정이 하나도 없으면 {@code unavailable / null / [] / null}. 관측 없는 날짜는 series 에 없다(0 으로 채우지 않음).</li>
     *   <li>기간 상태 = 가장 최근 날짜의 상태. 그것이 {@code denied} 면 측정된 과거 날짜를 series 에서 뺀다(권한을 거둔 뒤 노출하지 않음).</li>
     *   <li>합계는 지난 날짜({@code from..min(to, 오늘)})가 <b>전부</b> 측정됐을 때만 — 아니면 null. 부분 합을 전체처럼 보이지 않는다.
     *       오지 않은 미래 날짜는 결측으로 치지 않는다.</li>
     * </ul>
     */
    private static Summary summarize(List<ScreenTimeObservation> found, LocalDate from, LocalDate to,
                                     LocalDate today) {
        Map<LocalDate, Map<UUID, ScreenTimeObservation>> latest = new TreeMap<>();
        for (ScreenTimeObservation observation : found) {
            latest.computeIfAbsent(observation.getMeasuredDate(), ignored -> new LinkedHashMap<>())
                    .merge(observation.getDeviceId(), observation,
                            (a, b) -> a.getMeasuredAt().isAfter(b.getMeasuredAt()) ? a : b);
        }
        List<ScreenDay> series = new ArrayList<>();
        latest.forEach((date, devices) -> {
            Collection<ScreenTimeObservation> picked = devices.values();
            Instant updatedAt = picked.stream().map(ScreenTimeObservation::getMeasuredAt)
                    .max(Comparator.naturalOrder()).orElseThrow();
            if (picked.size() == 1) {
                ScreenTimeObservation only = picked.iterator().next();
                series.add(new ScreenDay(date, only.getMinutes(), only.getMeasurementStatus(), updatedAt));
            } else {
                series.add(new ScreenDay(date, null, UNAVAILABLE, updatedAt));
            }
        });
        if (series.isEmpty()) {
            return new Summary(UNAVAILABLE, null, List.of(), null);
        }
        String status = series.get(series.size() - 1).measurementStatus();
        // 권한을 거둔 뒤에는 그 전의 측정 숫자를 내리지 않는다 — 측정된 날(authorized)만 빼고, 날짜 상태를 바꿔 쓰지 않는다.
        List<ScreenDay> shown = DENIED.equals(status)
                ? series.stream().filter(day -> !AUTHORIZED.equals(day.measurementStatus())).toList()
                : series;
        Instant updatedAt = shown.stream().map(ScreenDay::updatedAt).max(Comparator.naturalOrder()).orElseThrow();
        LocalDate lastElapsed = to.isAfter(today) ? today : to;
        Map<LocalDate, ScreenDay> byDate = shown.stream().collect(Collectors.toMap(ScreenDay::date, day -> day));
        boolean complete = !lastElapsed.isBefore(from);
        int total = 0;
        for (LocalDate date = from; complete && !date.isAfter(lastElapsed); date = date.plusDays(1)) {
            ScreenDay day = byDate.get(date);
            complete = day != null && AUTHORIZED.equals(day.measurementStatus()) && day.minutes() != null;
            total += complete ? day.minutes() : 0;
        }
        return new Summary(status, complete ? total : null, shown, updatedAt);
    }

    // ------------------------------------------------------------------ 측정 PUT

    /**
     * 기기 측정 한 건을 저장한다 — (사용자, 기기, UTC 날짜, 관측 시각) 불변 행 + 최신 선택(RC-P07·P08).
     *
     * <ul>
     *   <li>같은 키·같은 본문은 첫 결과 재생, 다른 본문은 409 {@code IDEMPOTENCY_KEY_REUSED}({@link PublicCommandService}).</li>
     *   <li>새 키로 같은 시각·같은 내용은 무변경 200, 같은 시각·다른 내용은 409 {@code SCREEN_TIME_MEASUREMENT_CONFLICT}.</li>
     *   <li>더 새 시각은 그 기기·날짜의 선택을 대체한다(더하지 않는다). 더 오래된 관측은 선택을 바꾸지 않는다.</li>
     * </ul>
     * 응답은 그 기기·날짜의 최신 선택 관측이다. 같은 사용자의 PUT 은 users 행 배타 락으로 직렬화된다 —
     * 확인 후 삽입이 경합하지 않는다. 보상·퀘스트 진행·사건은 없다.
     */
    @Transactional
    public ScreenTimeDay putScreenTime(UUID userId, UUID sessionId, long authGeneration, LocalDate date,
                                       ScreenTimeUpload upload, UUID key) {
        Map<String, Object> semantic = new LinkedHashMap<>();
        semantic.put("minutes", upload.minutes());
        semantic.put("measurementStatus", upload.measurementStatus());
        semantic.put("timezone", upload.timezone());
        semantic.put("measuredAt", upload.measuredAt().toString());
        semantic.put("deviceId", upload.deviceId().toString());
        var command = new PublicCommandRequest(userId,
                "PUT:/me/screen-time/" + date + ":" + userId + ":" + upload.deviceId(), key, tree(semantic));
        var receipt = publicCommands.run(command,
                () -> requireDeviceSession(userId, sessionId, authGeneration, upload.deviceId()),
                // 재생 전 활성·세션·기기 재검사는 위 검사가 한다. receipt 는 본인 측정뿐이다.
                ignored -> { },
                () -> new PublicCommandResult(200, tree(record(userId, date, upload)), tree(List.of())))
                .value();
        try {
            return OutboxEnvelopeCodec.fromJson(receipt.data().toString(), ScreenTimeDay.class);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }

    private ScreenTimeDay record(UUID userId, LocalDate date, ScreenTimeUpload upload) {
        Instant now = clock.instant();
        // timestamptz 는 마이크로초까지다 — 저장 뒤 같은 시각으로 다시 찾도록 먼저 자른다.
        Instant measuredAt = upload.measuredAt().truncatedTo(ChronoUnit.MICROS);
        Instant dayStart = date.atStartOfDay(UTC).toInstant();
        Instant closesAt = dayStart.plus(Duration.ofDays(1)).plus(reportGrace);
        if (measuredAt.isBefore(dayStart) || measuredAt.isAfter(now.plus(futureTolerance)) || now.isAfter(closesAt)) {
            throw new StatsException(StatsErrorCode.SCREEN_TIME_OUT_OF_WINDOW);
        }
        UUID deviceId = upload.deviceId();
        observations.findByUserIdAndDeviceIdAndMeasuredDateAndMeasuredAt(userId, deviceId, date, measuredAt)
                .ifPresentOrElse(same -> {
                    if (!same.sameMeasurement(upload.minutes(), upload.measurementStatus())) {
                        throw new StatsException(StatsErrorCode.SCREEN_TIME_MEASUREMENT_CONFLICT);
                    }
                }, () -> observations.save(ScreenTimeObservation.builder().userId(userId).deviceId(deviceId)
                        .measuredDate(date).measuredAt(measuredAt).minutes(upload.minutes())
                        .measurementStatus(upload.measurementStatus()).build()));
        ScreenTimeObservation latest = observations
                .findFirstByUserIdAndDeviceIdAndMeasuredDateOrderByMeasuredAtDesc(userId, deviceId, date)
                .orElseThrow();
        return new ScreenTimeDay(date, latest.getMinutes(), latest.getMeasurementStatus());
    }

    /**
     * 활성 사용자(행 배타 락) → 살아 있는 세션·세대 → 측정 기기 = 이 세션. 기기 식별은 서버가 서명한 로그인 세션이다
     * (2026-09-19 결정 RC-기기) — 앱이 보낸 임의 deviceId 를 새 기기로 등록하지 않는다(RC-P09).
     */
    private void requireDeviceSession(UUID userId, UUID sessionId, long authGeneration, UUID deviceId) {
        User user = users.getCallerForUpdate(userId);
        if (authGeneration != user.getAuthGeneration()
                || sessions.verifySession(user.getId(), sessionId).filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
        if (!sessionId.equals(deviceId)) {
            throw new StatsException(StatsErrorCode.SCREEN_TIME_DEVICE_FORBIDDEN);
        }
    }

    // ------------------------------------------------------------------ 공통

    /** 살아 있는 섬의 활성 주민 + 도서관 완공. 권한 판정이 게이트보다 먼저다(LLD §7 과 같은 순서). */
    private Group requireLibraryResident(UUID userId, UUID islandId) {
        User caller = users.getCaller(userId);
        Group island = groups.getGroup(islandId);
        IslandMovementGuards.requireAlive(island);
        groups.getMembership(caller, island);
        if (!facilities.hasLibrary(islandId)) {
            throw new GroupException(GroupErrorCode.LIBRARY_LOCKED);
        }
        return island;
    }

    /** 현재 활성 주민 — 탈퇴 계정은 빼고 userId 오름차순. 떠난 주민·과거 주민은 싣지 않는다. */
    private List<User> residents(Group island) {
        return members.findByGroup(island).stream()
                .map(member -> member.getUser())
                .filter(user -> !user.isDeleted())
                .sorted(Comparator.comparing(User::getId, UUID_ORDER))
                .toList();
    }

    /** 기간은 Business 가 이미 검증했다 — 여기는 방어선이다(from ≤ to, 31일 이내). */
    private static void requireRange(LocalDate from, LocalDate to) {
        if (from.isAfter(to) || from.plusDays(MAX_DAYS - 1L).isBefore(to)) {
            throw new StatsException(StatsErrorCode.INVALID_DATE_RANGE);
        }
    }

    private static void requireMe(String scope) {
        if (!SCOPE_ME.equals(scope)) {
            throw new StatsException(StatsErrorCode.INVALID_DATE_RANGE);
        }
    }

    private static long sum(Map<LocalDate, Long> series) {
        return series.values().stream().mapToLong(Long::longValue).sum();
    }

    private static List<DaySeconds> days(Map<LocalDate, Long> series) {
        return series.entrySet().stream().map(e -> new DaySeconds(e.getKey(), e.getValue())).toList();
    }

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("회관 기록 명령 직렬화 실패", e);
        }
    }

    /** 세션 하나의 요청 범위 날짜 기여. */
    private record Contribution(FocusSessionDetail session, NavigableMap<LocalDate, Integer> byDate, long total) {
    }

    /** 한 사람의 기간 측정 요약. */
    private record Summary(String status, Integer total, List<ScreenDay> series, Instant updatedAt) {
    }
}
