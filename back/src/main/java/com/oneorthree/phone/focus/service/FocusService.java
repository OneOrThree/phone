package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.currency.service.CurrencyRewardPolicy;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.domain.FocusType;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.dto.FocusSessionCancelRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
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
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserStreakService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private static final int MAX_PAGE_SIZE = 100;

    // orphan(앱 강제종료로 endedAt 미기록) 자동 종료 임계값 — 이보다 오래된 진행 중 세션은 상한으로 종료.
    private static final Duration ORPHAN_TIMEOUT = Duration.ofHours(12);

    // GROMO-806: 스트릭 인정 최소 누적 집중 시간(초) = 10분. 그날 누적이 이 값 이상일 때만 스트릭을 갱신한다.
    private static final int STREAK_MIN_SECONDS = 600;

    // currency 폐쇄(서버 지급 전환): 세션 보상 = 집중 60초(1분)당 1코인. 앱은 floor(elapsed/10)로 적립했으나
    // (FocusSessionScreen.settleFocusBlock·OrphanFocusSettler), 서버 지급률은 오스카 결정으로 1분당 1코인으로
    // 조정했다(앱의 10초 단위에서 의도적 분기). 지급률 변경 시 관련 단위 테스트 기대값도 함께 바꿔야 한다.
    private static final int SESSION_REWARD_UNIT_SECONDS = 60;

    // 보상 인정 세션 길이 상한 — ORPHAN_TIMEOUT(12h)과 정렬. 정상 앱 세션은 이보다 길 수 없고(강제종료 세션도
    // 12h 상한으로 자동 마감), 위조 장시간 세션(startedAt 을 과거로 조작한 POST)의 대량 지급을 여기서 자른다.
    // 세션 저장·통계는 종전대로 수용(클라 신뢰 기존 정책) — 상한은 '지급'에만 적용한다.
    private static final long MAX_REWARDED_SESSION_SECONDS = ORPHAN_TIMEOUT.toSeconds();

    private final UserFocusTagRepository userFocusTagRepository;
    private final DefaultTagRepository defaultTagRepository;
    private final OccupationDefaultTagRepository occupationDefaultTagRepository;
    private final UserRepository userRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserStreakService userStreakService;
    private final CurrencyLedgerService currencyLedgerService;

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

        // GROMO-754: 직군 프리셋(occupation 추천)에서 채택한 태그(sourceOccupationDefaultTag != null)는 이름 변경 불가.
        // rename 은 옛 채택을 소프트삭제 후 새 이름으로 재채택하는데, 프리셋 태그를 rename 하면 그 프리셋 정체성이 끊긴다.
        // 커스텀 태그(sourceOccupationDefaultTag == null)만 rename 을 허용한다.
        //
        // NOTE(GROMO-853): 현재 채택 경로는 이 컬럼을 기록하지 않아 이 가드는 아직 미실효(항상 null)다 —
        // getDefaultTags 는 추천을 이름만 노출하고, setupFocusTag 는 UserFocusTag 를 user·defaultTag 만으로 저장한다.
        // 채택 시점 occupation 출처 기록 배선은 후속 티켓 GROMO-853 에서 다루며, 배선되면 이 가드가 그대로 실효한다
        // (에러코드·차단 로직은 여기 유지). PR #274 @codex 리뷰 지적 반영.
        if (tag.getSourceOccupationDefaultTag() != null) {
            throw new FocusException(FocusErrorCode.OCCUPATION_TAG_NOT_RENAMABLE);
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

        // GROMO-754: softDelete(더티, 지연 flush) 후 @Modifying 벌크(repointFocusTag) 실행 시 Hibernate auto-flush 가
        // 옛 deletedAt 을 먼저 반영하고, 이후 세션 재조회가 없어 stale 위험이 없다.
        tag.softDelete();
        UserFocusTag newTag = userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(user, target)
                .orElseGet(() -> userFocusTagRepository.save(UserFocusTag.builder()
                        .user(user)
                        .defaultTag(target)
                        .build()));

        // GROMO-754: 옛(소프트삭제) 태그를 참조하던 과거 세션 전부를 새로 확보한 태그로 재연결(전체기간, 총량 불변·귀속 이동).
        // 재연결이 없으면 과거 세션이 소프트삭제 태그를 계속 참조해 by-category 통계에서 '미분류'로 강등되고 오늘 총합에서 증발한다.
        focusSessionRepository.repointFocusTag(tag, newTag);
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
    public FocusSessionSaveResponse saveFocusSession(UUID userId, FocusSessionRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (body.getStartedAt() == null || body.getEndedAt() == null) {
            throw new IllegalArgumentException("시작/종료 시간은 필수입니다");
        }

        if (body.getEndedAt().isBefore(body.getStartedAt())) {
            throw new IllegalArgumentException("종료 시간이 시작 시간보다 앞설 수 없습니다");
        }

        UserFocusTag tag = resolveOwnedTag(userId, body.getFocusTagId());
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        LocalDate statDate = statDate(body.getEndedAt(), zone);

        // 재업로드 멱등(서버 지급 전환의 이중 지급 방어): 앱 업로드 대기열(pendingFocusUploads)은 응답이 유실되면
        // 서버가 이미 커밋한 세션을 같은 바디로 재전송한다. 매 POST 가 새 행을 만들면 행 기반 멱등키가 재생성돼
        // 지급·통계가 중복되므로, 같은 (user, 구간) 완료 세션이 있으면 저장·통계·지급 전부를 스킵하고
        // 현재 상태만 응답한다(재시도 클라는 성공 응답을 받아 대기열에서 제거). 유니크 제약이 없어 완전 동시
        // 요청 레이스는 남지만, 대기열 재시도는 순차 실행이라 실효 경로는 이걸로 닫힌다.
        boolean duplicated = focusSessionRepository.existsByUserAndStartedAtAndEndedAtAndStatus(
                user, body.getStartedAt(), body.getEndedAt(), FocusSessionStatus.COMPLETED);
        if (duplicated) {
            log.info("완료 세션 재업로드 스킵 — 동일 구간 세션 존재. userId={}, startedAt={}, endedAt={}",
                    userId, body.getStartedAt(), body.getEndedAt());
            int dayTotal = dailyFocusStatRepository.findByUserAndDate(user, statDate)
                    .map(DailyFocusStat::getTotalFocusSeconds).orElse(0);
            return new FocusSessionSaveResponse(dayTotal, dayTotal >= STREAK_MIN_SECONDS, 0, 0);
        }

        // GROMO-733: POST 는 완료(종료 시각 포함) 통째 저장 — status=COMPLETED 로 세팅해 'ACTIVE 로 남던' 부정합을 교정한다.
        // focusType 은 null 이면 INFINITE 기본(엔티티 @Builder.Default 정합, 하위호환).
        FocusSession saved = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .focusTag(tag)
                .status(FocusSessionStatus.COMPLETED)
                .focusType(body.getFocusType() != null ? body.getFocusType() : FocusType.INFINITE)
                .startedAt(body.getStartedAt())
                .endedAt(body.getEndedAt())
                .totalDistractionSeconds(body.getTotalDistractionSeconds())
                .build());

        // currency 폐쇄(서버 지급 전환): 세션 보상을 서버가 직접 지급한다. 앱의 /currency/earn 호출은 no-op 이 됐고
        // (구앱: 저장 시 서버 지급 + earn no-op / 신앱: 저장 시 서버 지급 + earn 미호출 → 어느 조합도 정확히 1회),
        // 멱등키(focus:{sessionId}:reward)가 같은 세션 행에 대한 이중 지급을, 위의 재업로드 스킵이 행 재생성을 막는다.
        // 지갑 변경·원장 기입은 이 저장 트랜잭션에 함께 묶인다(credit 전파 REQUIRED).
        int awardedCoins = sessionRewardCoins(body.getStartedAt(), body.getEndedAt(),
                body.getTotalDistractionSeconds(), Instant.now());
        if (awardedCoins > 0) {
            currencyLedgerService.credit(user, CurrencyTransactionType.SESSION_COMPLETE, awardedCoins,
                    "focus:" + saved.getId() + ":reward");
        }

        // GROMO-806: 그날 누적·스트릭 인정 여부를 응답에 실어 준다(additive — 구버전 앱은 무시).
        RecordCompletionResult result = recordCompletion(user, userId, tag, body.getStartedAt(), body.getEndedAt(),
                body.getTotalDistractionSeconds(), statDate);
        // 세션 지급액(#417)·목표 지급액(이 브랜치)을 함께 실어 준다(additive) — 클라가 획득 코인을 즉시 노출.
        return new FocusSessionSaveResponse(result.dayTotalFocusSeconds(), result.streakQualifiedToday(),
                awardedCoins, result.goalRewardCoins());
    }

    /**
     * 세션 보상 코인 계산 — 집중초를 지급 단위로 내림(currency 폐쇄).
     *
     * <p><b>지급률</b>: 집중 60초(1분)당 1코인 = {@code floor(집중초 / 60)}. 앱은 원래
     * {@code floor(elapsed / 10)}(FocusSessionScreen.settleFocusBlock·OrphanFocusSettler)로 블록 단위 차분
     * 적립했으나, 서버 지급률은 오스카 결정으로 1분당 1코인으로 조정했다(앱의 10초 단위에서 의도적 분기).
     *
     * <p><b>서버 근사</b>: 서버가 아는 집중초 = (endedAt − startedAt) − totalDistractionSeconds.
     * 앱은 블록마다 settleAt 마커를 회전시켜(브레이크 구간 제외) 구간 벽시계 ≈ 집중초 이고, 앱 페이로드는
     * 방해시간(distraction)을 0 으로 보낸다 — elapsed 는 집중 타이머 카운터라 방해시간이 애초에 빠져 있다.
     * 뽀모도로 다블록 세션은 세션 구간 단위 내림이라 블록별 누적 내림과 코인 수가 소폭 다를 수 있다 — 수용.
     *
     * <p><b>위조 방어(지급에만 적용, 저장·통계는 불변)</b>: endedAt 이 미래면 now 로 클램프해 미래 시각 조작분을
     * 지급에서 제외하고(정상 클라의 소폭 시계 오차는 자연 흡수), 지급 인정 길이를
     * {@link #MAX_REWARDED_SESSION_SECONDS}(12h, orphan 상한과 정렬)로 캡해 과거 startedAt 조작으로 만든
     * 위조 장시간 세션의 대량 발행을 차단한다. 정상 앱 세션은 어느 클램프에도 걸리지 않는다.
     */
    static int sessionRewardCoins(Instant startedAt, Instant endedAt, int totalDistractionSeconds, Instant now) {
        Instant effectiveEnd = endedAt.isAfter(now) ? now : endedAt;
        long focusedSeconds = Duration.between(startedAt, effectiveEnd).getSeconds() - totalDistractionSeconds;
        long rewardedSeconds = Math.min(focusedSeconds, MAX_REWARDED_SESSION_SECONDS);
        return (int) Math.max(0, rewardedSeconds / SESSION_REWARD_UNIT_SECONDS);
    }

    /**
     * 일별 집중 집계·스트릭 귀속 버킷 날짜를 계산한다.
     *
     * <p><b>기준: 유저 country_code 파생 존 로컬 날짜 (GROMO-803, screentime 561과 동일 기준).</b>
     * endedAt(세션 종료 시각) 을 유저 국가 존({@link CountryZoneResolver})으로 환산한 로컬 날짜를 버킷으로 쓴다.
     * countryCode 가 null·미지원이면 UTC 로 폴백한다(CountryZoneResolver). 스크린타임 저장 존과 정합.
     */
    private static LocalDate statDate(Instant endedAt, ZoneId zone) {
        return endedAt.atZone(zone).toLocalDate();
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

        // GROMO-733: focus_type 인입 — null 이면 INFINITE 기본(엔티티 @Builder.Default 정합, 하위호환).
        FocusSession saved = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .focusTag(tag)
                .focusType(body.focusType() != null ? body.focusType() : FocusType.INFINITE)
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
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        RecordCompletionResult result = recordCompletion(user, userId, tag, session.getStartedAt(), endedAt,
                body.totalDistractionSeconds(), statDate(endedAt, zone));

        long durationSeconds = Duration.between(session.getStartedAt(), endedAt).getSeconds();
        // GROMO-806: 그날 누적·스트릭 인정 여부를 응답에 추가(additive).
        return new FocusSessionEndResponse(session.getId(), session.getStartedAt(), endedAt,
                durationSeconds, body.totalDistractionSeconds(),
                result.dayTotalFocusSeconds(), result.streakQualifiedToday());
    }

    /**
     * 세션 취소(GROMO-733) — 진행 중(endedAt NULL) 세션을 status=CANCELED 로 마감한다.
     *
     * <p>endFocusSession 과 동일한 이중구조: cancelSessionIfActive(조건부 원자 UPDATE, endedAt IS NULL 가드)로
     * 취소를 원자적으로 성사시켜 이중/중복 취소를 멱등 처리하고(영향 row=0 이면 이미 종료/취소 → 409),
     * 성사된 요청만 관리 엔티티 cancel() 더티 flush 로 in-memory 상태를 정합시킨다.
     * 취소는 통계·스트릭 귀속이 없다(완료가 아님).
     */
    @Transactional
    public void cancelFocusSession(UUID userId, FocusSessionCancelRequest body) {
        FocusSession session = focusSessionRepository.findById(body.sessionId())
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));

        if (session.getUser() == null || !session.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        // 멱등/이중 취소 방지(TOCTOU 차단) — endedAt IS NULL 조건 단일 UPDATE 로 취소를 원자적으로 성사시키고,
        // 영향 row=0(이미 종료/취소됨)이면 409. → 취소를 성사시킨 요청만 관리 엔티티를 CANCELED 로 정합시킨다.
        Instant canceledAt = Instant.now();
        int updated = focusSessionRepository.cancelSessionIfActive(body.sessionId(), canceledAt);
        if (updated == 0) {
            throw new FocusException(FocusErrorCode.SESSION_ALREADY_ENDED);
        }

        session.cancel(canceledAt);
    }

    /**
     * orphan 정리(GROMO-610) — 앱 강제종료 등으로 ORPHAN_TIMEOUT 이전에 시작됐으나 미종료인 세션을
     * '시작+상한'으로 종료해 friend isFocusing 오염('영원히 집중중')을 제거한다.
     *
     * <p>자동 종료 세션은 종료 시각 신뢰도가 낮아(유저 미확정) DailyFocusStat/스트릭 통계에는 반영하지 않는다.
     * WHERE endedAt IS NULL 조건 조회이므로 유저 PATCH 와 경합해도 이미 종료된 세션은 대상에서 빠진다.
     *
     * <p>GROMO-804: 상태를 {@code AUTO_CLOSED} 로 표시해 by-category 실시간 집계에서도 제외한다
     * (기존엔 status=ACTIVE 로 남아 endedAt 만 채워져 by-category 에 새어 들어갔다 — /stats/focus 사전집계와 총합 불일치).
     *
     * <p>종료 반영은 엔티티 더티 라이트(autoClose)가 아니라 조건부 원자 UPDATE(markAutoClosedIfOpen)로 한다.
     * 스윕이 orphan 목록을 읽은 뒤 flush 전에 유저가 같은 세션을 PATCH(endSessionIfActive)로 완료하면, 더티 라이트는
     * 이미 recordCompletion 이 통계에 계수한 세션의 endedAt·status 를 무조건 덮어써(AUTO_CLOSED) by-category 에서
     * 사라지면서 /stats/focus 와 불일치하고 endedAt 도 오염된다. endedAt IS NULL 조건 UPDATE 로 이 경합을 차단하고,
     * 실제로 마감된(반환 1) 세션만 카운트한다(동시 완료돼 0 이 반환된 세션은 스킵).
     *
     * @return 자동 종료한 세션 수(경합으로 이미 완료된 세션 제외)
     */
    @Transactional
    public int sweepOrphanSessions(Instant now) {
        Instant threshold = now.minus(ORPHAN_TIMEOUT);
        List<FocusSession> orphans = focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(threshold);
        int closed = 0;
        for (FocusSession session : orphans) {
            Instant cappedEnd = session.getStartedAt().plus(ORPHAN_TIMEOUT);
            closed += focusSessionRepository.markAutoClosedIfOpen(session.getId(), cappedEnd);
        }
        return closed;
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
     *
     * @return 그날 누적 집중 초와 스트릭 인정 여부(응답 필드용, GROMO-806)
     */
    private RecordCompletionResult recordCompletion(User user, UUID userId, UserFocusTag tag,
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

        // ── DailyFocusStat upsert: statDate(country_code 존 로컬 날짜 버킷, GROMO-803) 기준 (user, date) 멱등 누적 ──
        // GROMO-642: 초 단위 누적(세션별 분 내림 제거 — 30초×10=300초 정확). goal(분)은 *60 초로 비교.
        int addedSeconds = (int) Duration.between(startedAt, endedAt).getSeconds();

        // 집중 목표 달성 지급액 — 아래 false→true 전이에서만 채워진다(전이 없으면 0).
        int goalRewardCoins = 0;

        // UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
        // INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
        // GROMO-806: 스트릭 게이트·응답 필드용 — 이 세션 반영 후 그날 누적 집중 초.
        int dayTotalFocusSeconds;
        Optional<DailyFocusStat> existingStat = dailyFocusStatRepository.findByUserAndDateForUpdate(user, statDate);
        if (existingStat.isPresent()) {
            // 기존 row 누적 (+= 방식) — 더티 체킹으로 반영됨, 별도 save() 불필요
            DailyFocusStat stat = existingStat.get();
            stat.setTotalFocusSeconds(stat.getTotalFocusSeconds() + addedSeconds);
            stat.setSessionCount(stat.getSessionCount() + 1);
            stat.setTotalDistractionSeconds(stat.getTotalDistractionSeconds() + totalDistractionSeconds);
            dayTotalFocusSeconds = stat.getTotalFocusSeconds();
            // isFocusTimeGoalAchieved: 이미 달성(true)이면 재판정 불필요 — 플래그 단방향이므로 조기 스킵
            if (!stat.isFocusTimeGoalAchieved()) {
                int goal = userFocusTimeSettingsRepository.findById(userId)
                        .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
                if (goal > 0 && stat.getTotalFocusSeconds() >= goal * 60) {
                    stat.setFocusTimeGoalAchieved(true);
                    // false→true 전이 순간 1회 발행 — 영속 플래그가 하루 1회를 보장 (GROMO-395)
                    logDailyFocusGoalAchieved(statDate, stat.getTotalFocusSeconds() / 60, goal);
                    goalRewardCoins = creditFocusGoal(user, userId, goal, statDate);
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
            dayTotalFocusSeconds = addedSeconds;
            if (goalAchieved) {
                // 신규 row 가 곧바로 달성 = false→true 전이와 동일 — 1회 발행 (GROMO-395)
                logDailyFocusGoalAchieved(statDate, addedSeconds / 60, goal);
                goalRewardCoins = creditFocusGoal(user, userId, goal, statDate);
            }
        }

        // GROMO-806: 스트릭 인정 게이트 — 그날 누적 집중이 STREAK_MIN_SECONDS(10분) 이상일 때만 갱신한다.
        // (예: 5분+6분 → 1회차 누적 300초<600 미갱신, 2회차 누적 660초>=600 갱신. 이미 인정된 날 재호출은
        //  기존 same-day 멱등이 무변화를 보장.) 세션 저장·일별 집계와 같은 트랜잭션(원자적),
        //  날짜 기준 동일(country_code 존 로컬 날짜, GROMO-803).
        boolean streakQualifiedToday = dayTotalFocusSeconds >= STREAK_MIN_SECONDS;
        if (streakQualifiedToday) {
            userStreakService.updateOnSessionComplete(user, statDate);
        }

        return new RecordCompletionResult(dayTotalFocusSeconds, streakQualifiedToday, goalRewardCoins);
    }

    /**
     * 집중 목표 달성 지급(GROMO-395) — 목표 달성 false→true 전이 순간 1회. 목표 분 기준으로 금액을 산정하고
     * 멱등키 {@code focusGoal:{userId}:{statDate}}(하루 1회) 로 세션 저장 트랜잭션에 함께 기입한다.
     *
     * @return 지급액(공식상 0 이면 지급 없이 0)
     */
    private int creditFocusGoal(User user, UUID userId, int goalMinutes, LocalDate statDate) {
        // 위조 채굴 방어(코드리뷰) — POST /focus-session 은 클라가 보낸 startedAt/endedAt 을 신뢰하므로,
        // 과거 날짜마다 목표 길이 세션을 위조 제출해 지급을 긁을 수 있다. 정상 지급 창을 오늘·어제로 한정해
        // (오프라인 늦은 업로드·자정 경계 허용) 그보다 오래된 날짜의 대량 채굴을 차단한다. 세션 자체의
        // 신뢰 검증(라이브 마커 대조 등)은 별도 후속 — #417 세션 위조방어와 정합.
        ZoneId zone = CountryZoneResolver.resolve(user.getCountryCode());
        if (statDate.isBefore(LocalDate.now(zone).minusDays(1))) {
            return 0;
        }
        int reward = CurrencyRewardPolicy.focusGoalReward(goalMinutes);
        if (reward > 0) {
            currencyLedgerService.credit(user, CurrencyTransactionType.FOCUS_GOAL, reward,
                    "focusGoal:" + userId + ":" + statDate);
        }
        return reward;
    }

    /**
     * 세션 완료 귀속 결과(GROMO-806) — 세션완료 응답의 추가 필드로 노출한다.
     *
     * @param dayTotalFocusSeconds  이 세션 반영 후 그날(statDate) 누적 집중 초
     * @param streakQualifiedToday  그날 누적이 스트릭 인정 기준(10분) 이상이라 스트릭을 갱신했는지
     * @param goalRewardCoins       이 세션으로 집중 목표를 처음 달성(false→true)했을 때의 지급액(전이 없으면 0)
     */
    public record RecordCompletionResult(int dayTotalFocusSeconds, boolean streakQualifiedToday,
                                         int goalRewardCoins) {
    }

    /** 일일 집중 목표 달성(false→true 전이) 이벤트 발행 — date 는 ISO(country_code 존 로컬 날짜, GROMO-803). */
    private void logDailyFocusGoalAchieved(LocalDate statDate, int totalFocusMinutes, int goalMinutes) {
        userActivityEventLogger.log(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED, Map.of(
                "date", statDate.toString(),
                "total_focus_minutes", totalFocusMinutes,
                "goal_minutes", goalMinutes));
    }
}
