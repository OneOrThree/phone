package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagResponse;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagsResponse;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.focus.repository.OccupationDefaultTagRepository;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserStreakService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private static final int MAX_PAGE_SIZE = 100;

    // orphan(앱 강제종료로 endedAt 미기록) 자동 종료 임계값 — 이보다 오래된 진행 중 세션은 상한으로 종료.
    private static final Duration ORPHAN_TIMEOUT = Duration.ofHours(12);

    private final UserFocusTagRepository userFocusTagRepository;
    private final DefaultTagRepository defaultTagRepository;
    private final OccupationDefaultTagRepository occupationDefaultTagRepository;
    private final UserRepository userRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserStreakService userStreakService;
    private final LeagueArenaUserRepository leagueArenaUserRepository;

    public List<FocusTagResponse> getFocusTags(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // GROMO-673: 유저가 채택한 태그(user_focus_tags) 목록. id 는 user_focus_tags.id, 이름은 defaultTag.name.
        return userFocusTagRepository.findByUserAndDeletedAtIsNull(user)
                .stream()
                .map(tag -> new FocusTagResponse(tag.getId(), tag.getDefaultTag().getName()))
                .toList();
    }

    /**
     * occupation별 기본(추천) 포커스 태그 조회.
     *
     * <p>occupation 파라미터가 주어지면 그 값으로, 없으면 로그인 유저의 저장 occupation 으로 조회한다.
     * 유저 occupation 도 없으면(온보딩 미완료) {@link FocusErrorCode#OCCUPATION_REQUIRED}(400).
     * 결과가 없으면 빈 tags 리스트로 200 을 반환한다(에러 아님).
     */
    public OccupationDefaultTagsResponse getDefaultTags(UUID userId, Occupation occupation) {
        Occupation resolved = occupation;
        if (resolved == null) {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
            resolved = user.getOccupation();
            if (resolved == null) {
                throw new FocusException(FocusErrorCode.OCCUPATION_REQUIRED);
            }
        }

        // GROMO-673: occupation_default_tags 가 default_tags 를 FK 로 참조 → 이름은 defaultTag.name. sort_order 유지.
        List<OccupationDefaultTagResponse> tags = occupationDefaultTagRepository
                .findByOccupationOrderBySortOrderAsc(resolved)
                .stream()
                .map(tag -> new OccupationDefaultTagResponse(tag.getDefaultTag().getName(), tag.getSortOrder()))
                .toList();

        return new OccupationDefaultTagsResponse(resolved, tags);
    }

    @Transactional
    public void setupFocusTag(UUID userId, FocusTagSetupRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // GROMO-673: 태그 정체성은 default_tags(글로벌 재사용 단위). 이름으로 find-or-create 후
        // 유저 채택 레코드(user_focus_tags)를 생성한다. 이미 채택한 태그면 unique(user, default_tag)로 멱등.
        DefaultTag defaultTag = defaultTagRepository.findByName(body.name())
                .orElseGet(() -> defaultTagRepository.save(DefaultTag.builder()
                        .name(body.name())
                        .build()));

        UserFocusTag existing = userFocusTagRepository
                .findByUserAndDefaultTagAndDeletedAtIsNull(user, defaultTag)
                .orElse(null);
        UserFocusTag savedTag = existing != null
                ? existing
                : userFocusTagRepository.save(UserFocusTag.builder()
                        .user(user)
                        .defaultTag(defaultTag)
                        .build());

        // 태그 이름은 유저 입력(PII 금지) — tag_id(user_focus_tags.id) 만 기록
        userActivityEventLogger.log(UserActivityEvent.FOCUS_TAG_CREATED,
                Map.of("tag_id", savedTag.getId().toString()));
    }

    @Transactional
    public void updateFocusTag(UUID userId, FocusTagUpdateRequest body) {
        UserFocusTag tag = userFocusTagRepository.findByIdAndDeletedAtIsNull(body.tagId())
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        User user = tag.getUser();

        // GROMO-673: 이름은 공유 default_tags 에 있어 default_tags 를 직접 rename 하면 이 태그를 공유하는 다른 유저·
        // occupation 추천까지 오염된다. UserFocusTag 는 참조 전용(정체성 재지정 mutator 없음)이므로 유저 태그
        // '이름 변경'은 = 기존 채택을 소프트 딜리트하고 새 이름의 default_tag 로 다시 채택한다.
        // (이미 새 이름을 활성 채택 중이면 그 행을 유지해 unique(user, default_tag) 위반과 중복을 피한다.)
        DefaultTag target = defaultTagRepository.findByName(body.name())
                .orElseGet(() -> defaultTagRepository.save(DefaultTag.builder()
                        .name(body.name())
                        .build()));

        // 이름이 실제로 같으면(같은 default_tag) 변경 없음 — no-op.
        // name 은 default_tags 전역 유일이라 이름 일치 = 정체성 일치(엔티티 id 미할당 상황에도 안전).
        if (tag.getDefaultTag().getName().equals(target.getName())) {
            return;
        }

        tag.softDelete();
        userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(user, target)
                .orElseGet(() -> userFocusTagRepository.save(UserFocusTag.builder()
                        .user(user)
                        .defaultTag(target)
                        .build()));
    }

    @Transactional
    public void deleteFocusTag(UUID userId, UUID tagId) {
        UserFocusTag tag = userFocusTagRepository.findByIdAndDeletedAtIsNull(tagId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        tag.softDelete();
    }

    public FocusSessionSliceResponse getFocusSessions(UUID userId, Instant from, Instant to, UUID cursor, int size) {
        if (from == null || to == null || from.isAfter(to)) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new FocusException(FocusErrorCode.INVALID_PAGE_REQUEST);
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        Slice<FocusSession> slice = focusSessionRepository
                .findSessionsByCursor(user, from, to, cursor, PageRequest.of(0, size));

        List<FocusSessionResponse> content = slice.getContent().stream()
                .map(session -> new FocusSessionResponse(
                        session.getFocusTag() != null ? session.getFocusTag().getId() : null,
                        session.getStartedAt(),
                        session.getEndedAt(),
                        session.getTotalDistractionSeconds()
                ))
                .toList();

        // 다음 커서 = 마지막 항목 id(hasNext 일 때만). content 는 id DESC 정렬이라 마지막이 최소 id.
        UUID nextCursor = slice.hasNext() && !slice.getContent().isEmpty()
                ? slice.getContent().get(slice.getContent().size() - 1).getId()
                : null;

        return new FocusSessionSliceResponse(content, size, slice.hasNext(), nextCursor);
    }

    @Transactional
    public void saveFocusSession(UUID userId, FocusSessionRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (body.getStartedAt() == null || body.getEndedAt() == null) {
            throw new IllegalArgumentException("시작/종료 시간은 필수입니다");
        }

        if (body.getEndedAt().isBefore(body.getStartedAt())) {
            throw new IllegalArgumentException("종료 시간이 시작 시간보다 앞설 수 없습니다");
        }

        UserFocusTag tag = resolveOwnedTag(userId, body.getFocusTagId());

        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .focusTag(tag)
                .startedAt(body.getStartedAt())
                .endedAt(body.getEndedAt())
                .totalDistractionSeconds(body.getTotalDistractionSeconds())
                .build());

        recordCompletion(user, userId, tag, body.getStartedAt(), body.getEndedAt(),
                body.getTotalDistractionSeconds(), statDate(body.getEndedAt()));
    }

    // GROMO-671(커밋3): local_date 제거로 일별 집계 버킷 날짜는 endedAt(UTC) 로 환산한다.
    private static LocalDate statDate(Instant endedAt) {
        return endedAt.atZone(ZoneOffset.UTC).toLocalDate();
    }

    /**
     * 라이브 집중 세션 시작(GROMO-610) — startedAt 만 기록한 진행 중(endedAt NULL) 세션을 INSERT.
     * 통계·스트릭은 종료(PATCH) 시점에 귀속하므로 여기서는 건드리지 않는다.
     */
    @Transactional
    public FocusSessionStartResponse startFocusSession(UUID userId, FocusSessionStartRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        Instant startedAt = body.startedAt() != null ? body.startedAt() : Instant.now();
        UserFocusTag tag = resolveOwnedTag(userId, body.focusTagId());

        FocusSession saved = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .focusTag(tag)
                .startedAt(startedAt)
                .build());

        return new FocusSessionStartResponse(saved.getId(), saved.getStartedAt());
    }

    /**
     * 라이브 집중 세션 종료(GROMO-610) — 진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리.
     * 완료 시점에 통계(DailyFocusStat)·스트릭·이벤트를 귀속시킨다(POST 완료 저장과 동일 로직 공유).
     */
    @Transactional
    public FocusSessionEndResponse endFocusSession(UUID userId, FocusSessionEndRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        FocusSession session = focusSessionRepository.findById(body.sessionId())
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));

        if (session.getUser() == null || !session.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        Instant endedAt = body.endedAt() != null ? body.endedAt() : Instant.now();
        if (endedAt.isBefore(session.getStartedAt())) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);
        }

        // 멱등/이중 완료 방지(TOCTOU 차단) — isEnded() 사전 조회는 동시 PATCH 2건이 둘 다 endedAt==null 을
        // 읽고 통과해 통계를 2번 누적할 수 있다. DB 단일 UPDATE(endedAt IS NULL 조건)로 종료를 원자적으로 성사시키고,
        // 영향 row=0(이미 종료됨)이면 409 로 recordCompletion 을 스킵한다. → 종료를 성사시킨 요청만 통계 1회 반영.
        int updated = focusSessionRepository.endSessionIfActive(body.sessionId(), endedAt);
        if (updated == 0) {
            throw new FocusException(FocusErrorCode.SESSION_ALREADY_ENDED);
        }

        UserFocusTag tag = session.getFocusTag();
        if (body.focusTagId() != null) {
            tag = resolveOwnedTag(userId, body.focusTagId());
            session.applyTag(tag);
        }

        // 조건부 UPDATE 로 이미 endedAt 이 채워진 관리 엔티티에 방해 지표·태그를 반영(더티 체킹). recordCompletion 은 1회.
        session.end(endedAt, body.totalDistractionSeconds());
        recordCompletion(user, userId, tag, session.getStartedAt(), endedAt,
                body.totalDistractionSeconds(), statDate(endedAt));

        long durationSeconds = Duration.between(session.getStartedAt(), endedAt).getSeconds();
        return new FocusSessionEndResponse(session.getId(), session.getStartedAt(), endedAt,
                durationSeconds, body.totalDistractionSeconds());
    }

    /**
     * orphan 정리(GROMO-610) — 앱 강제종료 등으로 ORPHAN_TIMEOUT 이전에 시작됐으나 미종료인 세션을
     * '시작+상한'으로 종료해 friend isFocusing 오염('영원히 집중중')을 제거한다.
     *
     * <p>자동 종료 세션은 종료 시각 신뢰도가 낮아(유저 미확정) DailyFocusStat/스트릭 통계에는 반영하지 않는다.
     * WHERE endedAt IS NULL 조건 조회이므로 유저 PATCH 와 경합해도 이미 종료된 세션은 대상에서 빠진다.
     *
     * @return 자동 종료한 세션 수
     */
    @Transactional
    public int sweepOrphanSessions(Instant now) {
        Instant threshold = now.minus(ORPHAN_TIMEOUT);
        List<FocusSession> orphans = focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(threshold);
        for (FocusSession session : orphans) {
            Instant cappedEnd = session.getStartedAt().plus(ORPHAN_TIMEOUT);
            session.end(cappedEnd, session.getTotalDistractionSeconds());
        }
        return orphans.size();
    }

    /** 태그 id(user_focus_tags.id)로 소유 태그를 조회(없으면 null 반환, 미소유면 FORBIDDEN). POST/PATCH 공용. */
    private UserFocusTag resolveOwnedTag(UUID userId, UUID focusTagId) {
        if (focusTagId == null) {
            return null;
        }
        UserFocusTag tag = userFocusTagRepository.findByIdAndDeletedAtIsNull(focusTagId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));
        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }
        return tag;
    }

    /**
     * 세션 완료 귀속 — FOCUS_SESSION_COMPLETED 로깅 + DailyFocusStat upsert(비관적 락) + 스트릭 갱신.
     * POST(완료 통째 저장)와 PATCH(라이브 종료)가 공유해 통계 로직을 한 곳으로 모은다.
     */
    private void recordCompletion(User user, UUID userId, UserFocusTag tag,
                                  Instant startedAt, Instant endedAt, int totalDistractionSeconds, LocalDate statDate) {
        long durationSeconds = Duration.between(startedAt, endedAt).getSeconds();
        // payload 에 null 값 금지 — nullable 인 focus_tag_id 는 태그 있을 때만 키 포함
        Map<String, Object> sessionPayload = new LinkedHashMap<>();
        sessionPayload.put("duration_seconds", durationSeconds);
        sessionPayload.put("total_distraction_seconds", totalDistractionSeconds);
        sessionPayload.put("has_tag", tag != null);
        if (tag != null) {
            sessionPayload.put("focus_tag_id", tag.getId().toString());
        }
        userActivityEventLogger.log(UserActivityEvent.FOCUS_SESSION_COMPLETED, sessionPayload);

        // ── DailyFocusStat upsert: 클라 로컬 날짜(statDate) 기준 (user, date) 멱등 누적 (GROMO-643) ──
        // GROMO-642: 초 단위 누적(세션별 분 내림 제거 — 30초×10=300초 정확). goal(분)은 *60 초로 비교.
        int addedSeconds = (int) Duration.between(startedAt, endedAt).getSeconds();

        // UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
        // INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
        Optional<DailyFocusStat> existingStat = dailyFocusStatRepository.findByUserAndDateForUpdate(user, statDate);
        if (existingStat.isPresent()) {
            // 기존 row 누적 (+= 방식) — 더티 체킹으로 반영됨, 별도 save() 불필요
            DailyFocusStat stat = existingStat.get();
            stat.setTotalFocusSeconds(stat.getTotalFocusSeconds() + addedSeconds);
            stat.setSessionCount(stat.getSessionCount() + 1);
            stat.setTotalDistractionSeconds(stat.getTotalDistractionSeconds() + totalDistractionSeconds);
            // isFocusTimeGoalAchieved: 이미 달성(true)이면 재판정 불필요 — 플래그 단방향이므로 조기 스킵
            if (!stat.isFocusTimeGoalAchieved()) {
                int goal = userFocusTimeSettingsRepository.findById(userId)
                        .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
                if (goal > 0 && stat.getTotalFocusSeconds() >= goal * 60) {
                    stat.setFocusTimeGoalAchieved(true);
                    // false→true 전이 순간 1회 발행 — 영속 플래그가 하루 1회를 보장 (GROMO-395)
                    logDailyFocusGoalAchieved(statDate, stat.getTotalFocusSeconds() / 60, goal);
                }
            }
        } else {
            // INSERT 경로: isFocusTimeGoalAchieved 판정을 builder에 포함시켜 INSERT 쿼리 1회로 줄임
            // UserFocusTimeSettings row 없거나 goal=0이면 플래그 false 유지
            int goal = userFocusTimeSettingsRepository.findById(userId)
                    .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
            boolean goalAchieved = goal > 0 && addedSeconds >= goal * 60;
            dailyFocusStatRepository.save(DailyFocusStat.builder()
                    .user(user)
                    .date(statDate)
                    .totalFocusSeconds(addedSeconds)
                    .sessionCount(1)
                    .totalDistractionSeconds(totalDistractionSeconds)
                    .isFocusTimeGoalAchieved(goalAchieved)
                    .build());
            if (goalAchieved) {
                // 신규 row 가 곧바로 달성 = false→true 전이와 동일 — 1회 발행 (GROMO-395)
                logDailyFocusGoalAchieved(statDate, addedSeconds / 60, goal);
            }
        }

        // 스트릭 갱신 — 세션 저장·일별 집계와 같은 트랜잭션(원자적), 날짜 기준도 동일(endedAt UTC)
        userStreakService.updateOnSessionComplete(user, statDate);

        // GROMO-646: 현재 ACTIVE 아레나 멤버면 주간 누적 집중 시간 반영(리그 탭·랭킹·주간 마감 정합).
        // 리그는 분 단위(초/60 내림) — 랭킹용 근사. 아레나 미배정 유저는 스킵. 락 조회로 동시 세션 lost update 차단.
        leagueArenaUserRepository.findByUserAndArenaStatusForUpdate(userId, LeagueArenaStatus.ACTIVE)
                .ifPresent(member -> member.addFocusMinutes(addedSeconds / 60));
    }

    /** 일일 집중 목표 달성(false→true 전이) 이벤트 발행 — date 는 ISO(UTC). */
    private void logDailyFocusGoalAchieved(LocalDate statDate, int totalFocusMinutes, int goalMinutes) {
        userActivityEventLogger.log(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED, Map.of(
                "date", statDate.toString(),
                "total_focus_minutes", totalFocusMinutes,
                "goal_minutes", goalMinutes));
    }
}
