package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.currency.support.CurrencyRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.FocusQueryService;
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
import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.common.port.EarlyWinConfirmationPort;
import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.repository.OccupationDefaultTagRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.NavigableSet;
import java.util.Optional;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;

/**
 * 집중 태그와 집중 세션의 도메인 로직. 세션이 들어오는 경로가 둘이라는 게 이 클래스를 지배한다 —
 * 완료본을 통째로 올리는 POST({@link #saveFocusSession})와, 마커를 열고 나중에 닫는
 * 시작/종료({@link #startFocusSession}/{@link #endFocusSession}) 다. 앱은 PATCH 가 실패하면 POST 로
 * 폴백하므로 <b>같은 집중 블록이 두 경로로 도착할 수 있고</b>, 통계·코인 이중 계상을 막는 장치가
 * 곳곳에 깔려 있다(마커 선점·구간 중복 검사·조건부 원자 UPDATE).
 *
 * <p>시간 축은 두 겹이다. 클라가 보낸 시각은 라이브 경로에서 서버 수신 시각 기준 [-5분, 0] 창으로
 * 클램프해 저장하고, 날짜 버킷은 유저 국가와 무관하게 <b>KST 고정</b>이다({@link ZonePolicy}).
 *
 * <p>클래스 기본이 {@code readOnly = true} 라, 쓰기 경로만 메서드에 {@code @Transactional} 을 따로 단다.
 * readOnly 트랜잭션에서는 Postgres 가 {@code FOR SHARE} 를 거절하므로 조회 경로는 락 없는 활성 필터를 쓴다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private static final int MAX_PAGE_SIZE = 100;

    /**
     * orphan(앱 강제종료로 endedAt 미기록) 자동 종료 임계값 — 이보다 오래된 진행 중 세션은 상한으로 종료.
     */
    private static final Duration ORPHAN_TIMEOUT = Duration.ofHours(12);

    /**
     * GROMO-806: 스트릭 인정 최소 누적 집중 시간(초) = 10분. 그날 누적이 이 값 이상일 때만 스트릭을 갱신한다.
     * 정본은 UserStreakService — 소급 재구성(5차 ③)이 같은 기준으로 과거 자격을 판정한다.
     */
    private static final int STREAK_MIN_SECONDS = UserStreakService.STREAK_MIN_SECONDS;

    /**
     * currency 폐쇄(서버 지급 전환): 세션 보상 = 집중 60초(1분)당 1코인. 앱은 floor(elapsed/10)로 적립했으나
     * (FocusSessionScreen.settleFocusBlock·OrphanFocusSettler), 서버 지급률은 오스카 결정으로 1분당 1코인으로
     * 조정했다(앱의 10초 단위에서 의도적 분기). 지급률 변경 시 관련 단위 테스트 기대값도 함께 바꿔야 한다.
     */
    private static final int SESSION_REWARD_UNIT_SECONDS = 60;

    /**
     * 보상 인정 세션 길이 상한 — ORPHAN_TIMEOUT(12h)과 정렬. 정상 앱 세션은 이보다 길 수 없고(강제종료 세션도
     * 12h 상한으로 자동 마감), 위조 장시간 세션(startedAt 을 과거로 조작한 POST)의 대량 지급을 여기서 자른다.
     * 세션 저장·통계는 종전대로 수용(클라 신뢰 기존 정책) — 상한은 '지급'에만 적용한다.
     */
    private static final long MAX_REWARDED_SESSION_SECONDS = ORPHAN_TIMEOUT.toSeconds();

    /**
     * GROMO-1214: 클라가 보낸 시각을 수용하는 창 = 서버 수신 시각 기준 [now-5분, now]. 라이브 마커 경로
     * (start/PATCH)에만 적용한다 — 이 창을 벗어난 값은 서버 시각으로 대체해 startedAt 을 과거로,
     * endedAt 을 미래로 조작한 시간 뻥튀기를 차단한다. 5분은 정상 클라의 시계 오차·네트워크 지연 여유분.
     */
    private static final Duration CLIENT_CLOCK_TOLERANCE = Duration.ofMinutes(5);

    /**
     * GROMO-1252: 자정 분할이 만들 수 있는 날짜 조각 수 상한. POST 는 클라 시각을 신뢰하므로 startedAt 을
     * 몇 년 전으로 조작한 세션이 날짜 수만큼 일별 upsert(행 잠금 포함)를 만들어 한 트랜잭션을 부풀릴 수 있다.
     * 정상 세션은 12h(orphan 상한) 이내라 조각이 2개를 넘지 않는다 — 상한 초과분은 마지막 조각에 합쳐
     * 총합은 보존한 채 작업량만 자른다. 업로드 맵 엔트리 상한(400 검증)과 같은 값을 쓴다(정본은 DTO).
     */
    private static final int MAX_SPLIT_DAYS = FocusSessionRequest.MAX_SECONDS_BY_DATE_ENTRIES;

    private final UserFocusTagRepository userFocusTagRepository;
    private final DefaultTagRepository defaultTagRepository;
    private final OccupationDefaultTagRepository occupationDefaultTagRepository;
    private final UserQueryService userQueryService;
    private final FocusSessionRepository focusSessionRepository;
    private final FocusQueryService focusQueryService;
    private final UserActivityEventLogger userActivityEventLogger;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserStreakService userStreakService;
    private final CurrencyLedgerService currencyLedgerService;
    private final EarlyWinConfirmationPort earlyWinConfirmationPort;
    private final FocusPresencePort focusPresencePort;
    /**
     * 서버 시계 (GROMO-1723) — 클램프 창·귀속 날짜·지급 창이 전부 «지금»에 기대므로 벽시계를 직접 읽지
     * 않고 주입받는다. 운영에선 {@code config/ClockConfig} 의 시스템 시계, 테스트에선 고정 시계다.
     * 테스트가 {@code Instant.now()} 로 «지금 - 1시간» 세션을 만들면 KST 00~01시에 자정을 걸쳐
     * 날짜 분할(GROMO-1252)이 정상 동작하면서 단언이 깨진다 — 매일 1시간씩 CI 가 빨갰던 원인.
     */
    private final Clock clock;

    /**
     * 유저가 채택 중인 집중 태그 목록.
     *
     * @param userId 조회 주체. 탈퇴 유저는 404({@code UserErrorCode.USER_NOT_FOUND})
     * @return 활성 채택 태그. id 는 채택 행(user_focus_tags)의 id 이고 이름은 공유 마스터에서 읽는다.
     *         소프트삭제된 옛 태그는 빠지므로 이름을 바꾼 태그는 <b>새 id</b> 로 나온다
     */
    public List<FocusTagResponse> getFocusTags(UUID userId) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userQueryService.getCaller(userId);

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
     *
     * @param userId     로그인 유저. occupation 을 생략했을 때만 조회한다
     * @param occupation 조회할 직군. null 이면 유저에 저장된 직군으로 대체하고, 그것도 없으면 400
     * @return 해당 직군의 추천 태그(노출 순서 유지). <b>tagId 가 없다</b> — 유저가 고르면 이름을 태그 등록으로
     *         다시 보내 실제 채택 행을 만든다
     */
    public OccupationDefaultTagsResponse getDefaultTags(UUID userId, Occupation occupation) {
        Occupation resolved = occupation;
        if (resolved == null) {
            // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
            User user = userQueryService.getCaller(userId);
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

    /**
     * 태그 채택 — 이름 마스터를 find-or-create 한 뒤 이 유저의 채택 행을 만든다.
     *
     * <p>이미 채택 중인 이름이면 아무것도 만들지 않고 기존 행을 그대로 둔다(멱등). 이름은 전역 공유라
     * 다른 유저가 같은 이름을 쓰고 있으면 그 마스터를 재사용한다.
     *
     * @param userId 채택 주체. 탈퇴 유저면 404
     * @param body   채택할 태그 이름. 유저 입력이라 활동 로그에는 이름을 남기지 않고 태그 id 만 남긴다
     */
    @Transactional
    public void setupFocusTag(UUID userId, FocusTagSetupRequest body) {
        User user = requireActiveUser(userId);

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

    /**
     * 태그 이름 변경 — 실제로는 <b>옛 채택 행을 소프트삭제하고 새 이름으로 다시 채택</b>한다.
     * 이름은 전역 마스터가 들고 있어 마스터를 직접 고치면 같은 이름을 쓰는 다른 유저까지 오염되기 때문이다.
     *
     * <p>그래서 과거 세션이 옛 행을 계속 가리키게 두면 통계에서 '미분류'로 강등된다 — 벌크 UPDATE 로
     * 전체 기간의 세션을 새 행에 재연결한다(총량은 그대로, 귀속만 이동).
     *
     * @param userId 요청자. 남의 태그면 403
     * @param body   대상 태그 id 와 새 이름. 이름이 실제로 같으면 아무것도 하지 않는다
     * @throws com.oneorthree.phone.focus.exception.FocusException 태그가 없거나(404), 남의 태그거나(403),
     *         직군 프리셋에서 온 태그를 rename 하려 할 때(400)
     */
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

    /**
     * 태그 채택 해제 — 소프트삭제라 과거 세션의 참조는 살아 있고, 그 세션들은 통계에서 삭제된 태그로 남는다.
     *
     * @param userId 요청자. 남의 태그면 403
     * @param tagId  해제할 채택 행 id. 이미 해제된 태그면 404
     */
    @Transactional
    public void deleteFocusTag(UUID userId, UUID tagId) {
        UserFocusTag tag = userFocusTagRepository.findByIdAndDeletedAtIsNull(tagId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        tag.softDelete();
    }

    /**
     * 세션 목록 — 기간 필터 + 커서(keyset) 페이지네이션.
     *
     * @param userId 조회 주체. 탈퇴 유저면 404
     * @param from   창 시작(UTC 절대시각, 포함). {@code startedAt} 기준이라 자정을 걸친 세션은 시작일 쪽에 잡힌다
     * @param to     창 끝(포함). from 보다 앞서면 400
     * @param cursor 직전 페이지 마지막 세션 id. null 이면 첫 페이지
     * @param size   페이지 크기. 1~100 밖이면 400
     * @return 최신순 한 페이지 + 다음 커서. 취소·자동마감 세션은 빠지지만 <b>진행 중 세션은 남으므로</b>
     *         클라가 합산할 때 종료 시각이 빈 항목을 걸러야 한다
     */
    public FocusSessionSliceResponse getFocusSessions(UUID userId, Instant from, Instant to, UUID cursor, int size) {
        if (from == null || to == null || from.isAfter(to)) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new FocusException(FocusErrorCode.INVALID_PAGE_REQUEST);
        }

        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        User user = userQueryService.getCaller(userId);

        Slice<FocusSession> slice = focusSessionRepository
                .findSessionsByCursor(user, from, to, cursor, PageRequest.of(0, size));

        List<FocusSessionResponse> content = slice.getContent().stream()
                .map(session -> new FocusSessionResponse(
                        session.getFocusTag() != null ? session.getFocusTag().getId() : null,
                        session.getStartedAt(),
                        session.getEndedAt(),
                        session.getTotalDistractionSeconds(),
                        // GROMO-1252 3차 ①: 확정 분포를 함께 내려 앱 복원이 사전집계와 같은 귀속을 쓰게 한다.
                        session.getFocusSecondsByDate()
                ))
                .toList();

        // 다음 커서 = 마지막 항목 id(hasNext 일 때만). content 는 id DESC 정렬이라 마지막이 최소 id.
        UUID nextCursor = slice.hasNext() && !slice.getContent().isEmpty()
                ? slice.getContent().get(slice.getContent().size() - 1).getId()
                : null;

        return new FocusSessionSliceResponse(content, size, slice.hasNext(), nextCursor);
    }

    /**
     * 완료된 집중 블록을 통째로 저장하고 통계·스트릭·코인을 한 트랜잭션에서 귀속시킨다.
     *
     * <p>같은 블록이 두 번 도착할 수 있는 경로다 — 업로드 대기열의 재전송과, PATCH 실패 후의 마커 폴백.
     * 그래서 저장 전에 두 겹으로 거른다: 바디에 마커 id 가 실려 있으면 그 마커를 조건부 UPDATE 로
     * <b>선점</b>해 PATCH 와 직렬화하고, 그 외에는 같은 (유저, 시작, 종료) 완료 행이 있는지 본다.
     * 중복으로 판정되면 저장·통계·지급을 전부 건너뛰고 현재 상태만 돌려준다(재시도 클라가 대기열을 비울 수 있게).
     *
     * <p>이 경로는 클라 시각을 클램프하지 않는다(중복 검사 전제). 대신 미래 종료 위조는 통계 귀속용
     * 유효 종료로 잘라내고, 보상은 12시간 상한에서 끊는다.
     *
     * @param userId 업로드 주체. 탈퇴 유저면 404이고, 남의 태그를 지정하면 403
     * @param body   집중 블록. 시작·종료는 필수이고 종료가 시작보다 앞서면 400.
     *               날짜별 집중 초를 실어 보내면 자정을 걸친 세션의 날짜 귀속에 그 분포를 쓰고,
     *               없으면 서버가 KST 벽시계로 쪼갠다
     * @return 그날(KST) 누적 집중 초·스트릭 인정 여부·이번에 지급된 코인·잔액. 중복으로 스킵된 경우
     *         지급액은 0 이고 누적치는 이미 반영된 값이 실린다
     */
    @Transactional
    public FocusSessionSaveResponse saveFocusSession(UUID userId, FocusSessionRequest body) {
        User user = requireActiveUser(userId);

        if (body.getStartedAt() == null || body.getEndedAt() == null) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);   // 400 (GROMO-1725, 종전 IAE 409)
        }

        if (body.getEndedAt().isBefore(body.getStartedAt())) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);
        }

        UserFocusTag tag = resolveOwnedTag(userId, body.getFocusTagId());
        ZoneId zone = ZonePolicy.KST;   // GROMO-1259: 저장축 KST 고정 (N8/FR-19, 해외 유저는 L5 수용)
        // 미래 endedAt 위조 클램프 + 날짜별 귀속 분포를 한 번만 구해 저장·통계·중복응답이 같은 값을 쓴다.
        Instant now = clock.instant();
        Instant statEnd = statEnd(body.getEndedAt(), now);
        CreditedByDate credited = resolveSecondsByDate(
                body.getStartedAt(), statEnd, zone, body.getFocusSecondsByDate(),
                body.getTotalDistractionSeconds());
        // 응답의 "그날 누적"은 실제로 조각이 쓰인 마지막(가장 늦은) 날짜 기준 — endedAt 에서 직접 파생하면
        // 정확히 자정에 끝난 세션에서 최초 저장(전날 조각)과 재업로드 응답(다음날)이 다른 날짜를 본다(코드리뷰 ⑤).
        LocalDate statDate = credited.focusSeconds().isEmpty()
                ? statDate(body.getEndedAt(), zone) : credited.focusSeconds().lastKey();

        // 재업로드 멱등(서버 지급 전환의 이중 지급 방어): 앱 업로드 대기열(pendingFocusUploads)은 응답이 유실되면
        // 서버가 이미 커밋한 세션을 같은 바디로 재전송한다. 매 POST 가 새 행을 만들면 행 기반 멱등키가 재생성돼
        // 지급·통계가 중복되므로, 같은 (user, 구간) 완료 세션이 있으면 저장·통계·지급 전부를 스킵하고
        // 현재 상태만 응답한다(재시도 클라는 성공 응답을 받아 대기열에서 제거). 유니크 제약이 없어 완전 동시
        // 요청 레이스는 남지만, 대기열 재시도는 순차 실행이라 실효 경로는 이걸로 닫힌다.
        //
        // GROMO-1214 코드리뷰(기기 시계 스큐): 구간 완전일치 검사만으로는 마커 폴백을 못 잡는다. 마커 경로는
        // 서버가 시각을 클램프해 저장하므로, PATCH 가 커밋된 뒤 응답만 유실돼 앱이 POST 로 폴백하면 저장값
        // (서버 시각)과 폴백 바디(기기 시각)가 어긋나 dedup 을 통과해 버린다. 폴백 바디가 실어 보낸 마커 id 를
        // 기준으로 거른다.
        //
        // GROMO-1214 코드리뷰 2차(원자성): 종전엔 이 판정이 insert 전 **존재 조회**뿐이라, PATCH 가 타임아웃돼
        // (서버 트랜잭션은 계속 도는 중) 앱이 곧바로 POST 로 폴백하면 조회가 아직 커밋 전인 마커를 ACTIVE 로 보고
        // 통과했다 — 두 트랜잭션이 나란히 커밋되며 통계·보상이 두 번 들어갔다. 이제 조회 대신 **조건부 UPDATE 로
        // 마커를 선점**한다(claimMarkerIfActive). 마커 행 잠금이 PATCH 와 이 POST 를 직렬화하므로 순서와 무관하게
        // 완료는 한 번뿐이다:
        //   선점 성공(row=1) → 이 POST 가 마커를 CANCELED 로 닫았다. 완료 행은 아래에서 새로 만든다(지급 1회).
        //   선점 실패(row=0) → 이미 닫힌 마커다. COMPLETED 면 PATCH 가 이겼으므로 저장·통계·지급을 전부 스킵하고,
        //                      CANCELED/AUTO_CLOSED(SESSION_DISCARDED 폴백)면 통계 미반영분이라 그대로 새로 저장한다.
        //
        // GROMO-1214 코드리뷰 3차 ③(폐기 마커 폴백의 직렬화): 선점이 0 행이면 마커 행 잠금을 얻지 못한 채
        // 비원자적 구간 존재 조회만 남는다 — 폐기 마커 폴백 POST 가 타임아웃된 채 서버 트랜잭션이 도는 중에
        // 큐 재시도가 겹치면 둘 다 '완료 구간 없음'을 보고 각각 완료 행·통계·보상을 만든다(유니크 제약 없음).
        // 그래서 상태 확인을 존재 조회가 아니라 <b>마커 행 비관적 락</b>({@code findByIdAndUserForUpdate})으로 한다 —
        // 검사~INSERT 구간이 마커 단위로 직렬화돼, 뒤이은 재시도는 앞선 트랜잭션이 커밋한 완료 행을 구간 검사에서
        // 보게 된다. 마커가 없거나(구버전·오프라인) 남의 것이면 잠글 대상이 없으므로 종전대로 진행한다.
        // 잠금 순서는 PATCH(endFocusSession)와 동일하다 — users(공유, requireActiveUser) → focus_sessions 마커 행
        // → 지갑 → daily_focus_stats. 두 경로가 같은 순서라 교착이 생기지 않는다(GROMO-801 락 규율).
        int markerClaimed = body.getSessionId() != null
                ? focusSessionRepository.claimMarkerIfActive(body.getSessionId(), user, now)
                : 0;

        // GROMO-292: 선점 성공(row=1) = **이 POST 가 열려 있던 마커를 방금 닫았다** → 집중이 끝났다.
        // 이 경로에서 리스를 안 지우면 아무도 못 지운다: PATCH 는 실패했고(그래서 POST 폴백이다),
        // 앱의 병행 취소는 이미 닫힌 마커라 409 를 받는다. 그러면 실제로 집중이 끝난 사람이 TTL(13h)
        // 내내 채팅에서 막힌다.
        // 선점 실패(row=0)일 때는 «지우지 않는다» — 그 마커는 다른 경로가 이미 닫았고(그쪽이 지웠다),
        // 그 사이 새로 시작한 집중의 리스를 여기서 날리면 안 된다.
        if (markerClaimed > 0) {
            focusPresencePort.focusEnded(userId, body.getSessionId());
        }

        boolean markerAlreadyCompleted = body.getSessionId() != null
                && markerClaimed == 0
                && focusSessionRepository.findByIdAndUserForUpdate(body.getSessionId(), user)
                        .map(marker -> marker.getStatus() == FocusSessionStatus.COMPLETED)
                        .orElse(false);
        boolean duplicated = markerAlreadyCompleted
                || focusSessionRepository.existsByUserAndStartedAtAndEndedAtAndStatus(
                        user, body.getStartedAt(), body.getEndedAt(), FocusSessionStatus.COMPLETED);
        if (duplicated) {
            log.info("완료 세션 재업로드 스킵 — 동일 구간 세션 존재. userId={}, startedAt={}, endedAt={}",
                    userId, body.getStartedAt(), body.getEndedAt());
            int dayTotal = dailyFocusStatRepository.findByUserAndDate(user, statDate)
                    .map(DailyFocusStat::getTotalFocusSeconds).orElse(0);
            return new FocusSessionSaveResponse(dayTotal, dayTotal >= STREAK_MIN_SECONDS, 0, 0,
                    currencyLedgerService.balanceOf(user));
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
                // 통계 귀속용 유효 종료(GROMO-1252 ②) — 저장되는 endedAt 은 클라 값 그대로(중복 검사 전제).
                .statEndAt(statEnd)
                // 확정 분포도 함께 보관(GROMO-1252 ③차 ①) — 조회 집계·앱 복원이 사전집계와 같은 값을 쓴다.
                // 저장하는 건 **순수 집중초(net)** 다 — 읽는 쪽이 방해초를 다시 빼면 이중 차감이다(1214 3차 ①).
                .focusSecondsByDate(toStoredSecondsByDate(credited.focusSeconds()))
                .totalDistractionSeconds(body.getTotalDistractionSeconds())
                .build());

        // 락 순서 고정(계약 §3: 회차 → 지갑) — 지갑을 만지기 전에 조기 확정 대상 회차를 먼저 잠근다.
        // 지갑부터 잡고 나중에 회차 락을 기다리면 정산·삭제 경로와 정확히 역순이라 교착·낙관락
        // 충돌로 이 트랜잭션(집중 세션·통계·보상)이 통째로 롤백된다.
        earlyWinConfirmationPort.lockCandidateSessions(userId, credited.focusSeconds().keySet());

        // currency 폐쇄(서버 지급 전환): 세션 보상을 서버가 직접 지급한다. 앱의 /currency/earn 호출은 no-op 이 됐고
        // (구앱: 저장 시 서버 지급 + earn no-op / 신앱: 저장 시 서버 지급 + earn 미호출 → 어느 조합도 정확히 1회),
        // 멱등키(focus:{sessionId}:reward)가 같은 세션 행에 대한 이중 지급을, 위의 재업로드 스킵이 행 재생성을 막는다.
        // 지갑 변경·원장 기입은 이 저장 트랜잭션에 함께 묶인다(credit 전파 REQUIRED).
        int awardedCoins = creditSessionReward(user, saved.getId(), body.getStartedAt(), body.getEndedAt(),
                body.getTotalDistractionSeconds());

        // GROMO-806: 그날 누적·스트릭 인정 여부를 응답에 실어 준다(additive — 구버전 앱은 무시).
        RecordCompletionResult result = recordCompletion(user, userId, tag, body.getStartedAt(), body.getEndedAt(),
                body.getTotalDistractionSeconds(), zone, credited);
        // 그룹 내기 개인 승리 조기 확정(GROMO-1268, N11) — 통계 반영 이후, 같은 트랜잭션에 편승한다.
        // 대상은 이 세션이 통계에 귀속된 날짜들의 FOCUS OPEN 회차뿐이다(회차 락은 confirmer 가 잡는다).
        earlyWinConfirmationPort.confirmWins(userId, credited.focusSeconds().keySet());
        // 세션 지급액(#417)·목표 지급액(이 브랜치)을 함께 실어 준다(additive) — 클라가 획득 코인을 즉시 노출.
        // balanceAfter 는 구 번들 호환용으로만 남긴다(현재 앱은 재조회로 잔액을 받는다).
        return new FocusSessionSaveResponse(result.dayTotalFocusSeconds(), result.streakQualifiedToday(),
                awardedCoins, result.goalRewardCoins(), currencyLedgerService.balanceOf(user));
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
     * 클라가 보낸 시각을 서버 수신 시각 창으로 클램프한다 (GROMO-1214).
     *
     * <p>수용 창은 {@code [now - CLIENT_CLOCK_TOLERANCE, now]} — 미래는 1초도 허용하지 않고, 과거는 5분까지만
     * 그대로 쓴다. 창 밖(또는 null)이면 {@code now} 로 대체한다. 변조 앱이 startedAt 을 몇 시간 전으로,
     * endedAt 을 몇 시간 뒤로 보내 시간·코인을 부풀리는 경로를 닫는 게 목적이다.
     *
     * <p><b>마커 경로(POST /focus-session/start · PATCH /focus-session) 전용</b> — POST /focus-session
     * (완료 통째 저장)의 저장 값에는 적용하지 않는다. 그쪽 재업로드 멱등은 앱이 보낸 startedAt/endedAt 이
     * 그대로 저장되는 것을 전제로 {@code existsByUserAndStartedAtAndEndedAtAndStatus} 로 중복을 잡는데,
     * 클램프로 값이 바뀌면 같은 세션 재전송이 dedup 을 빠져나가 이중 계상된다. POST 의 위조 방어는
     * 종전대로 {@link #sessionRewardCoins} 의 '지급에만 적용되는' 미래 클램프·12h 캡이 담당한다.
     *
     * <p><b>부작용(수용)</b>: 오프라인으로 세션을 시작해 5분 넘게 지난 뒤 마커를 만들면 그 앞 구간은 버려진다.
     * 오프라인 세션은 앱이 종전 POST 경로로 올린다.
     */
    static Instant clampToServerNow(Instant clientValue, Instant now) {
        if (clientValue == null || clientValue.isAfter(now)
                || clientValue.isBefore(now.minus(CLIENT_CLOCK_TOLERANCE))) {
            return now;
        }
        return clientValue;
    }

    /**
     * 세션 보상 코인 지급 — POST(완료 통째 저장)·PATCH(라이브 마커 종료) 공용 (GROMO-1214).
     *
     * <p>지급률·상한({@link #sessionRewardCoins})과 멱등키 형태({@code focus:{sessionId}:reward})를 한 곳에
     * 모아 두 경로가 같은 계산을 두 벌 갖지 않게 한다. PATCH 는 {@code endSessionIfActive} 원자 가드가
     * 이중 종료를 409 로 막으므로 세션 1건당 지급도 1회다.
     *
     * @return 이번 호출로 지급한 코인(0 이면 미지급 — credit 자체를 호출하지 않는다)
     */
    private int creditSessionReward(User user, UUID sessionId, Instant startedAt, Instant endedAt,
                                    int totalDistractionSeconds) {
        int awardedCoins = sessionRewardCoins(startedAt, endedAt, totalDistractionSeconds, clock.instant());
        if (awardedCoins > 0) {
            currencyLedgerService.credit(user, CurrencyTransactionType.SESSION_COMPLETE, awardedCoins,
                    "focus:" + sessionId + ":reward");
        }
        return awardedCoins;
    }

    /**
     * 세션이 끝난 날(= 앱이 보는 "오늘")의 로컬 날짜.
     *
     * <p><b>기준: KST 로컬 날짜 (GROMO-1259 — 저장축 KST 고정, {@link ZonePolicy}).</b>
     * 스크린타임 저장 존과 정합(같은 KST 축). 해외 유저 어긋남은 L5 수용.
     *
     * <p>GROMO-1252 이후 <b>집계 귀속</b>은 이 날짜 하나가 아니라 {@link #splitByLocalDay} 가 나눈 날짜별
     * 조각으로 이뤄진다 — 이 헬퍼는 재업로드 응답의 "그날 누적" 조회처럼 종료일 하나만 필요한 곳에 쓴다.
     */
    private static LocalDate statDate(Instant endedAt, ZoneId zone) {
        return endedAt.atZone(zone).toLocalDate();
    }

    /**
     * 세션 구간 [startedAt, endedAt] 을 KST 로컬 자정 경계로 잘라 날짜별 초를 배분한다 (GROMO-1252 · 1259).
     *
     * <p>종전엔 endedAt 하나의 로컬 날짜에 구간 전체를 가산해, 자정을 넘긴 세션은 전날 몫이 통째로 사라지고
     * 다음날이 부풀었다(prod 실측 10.7h 오귀속).
     *
     * <p><b>반환은 날짜 오름차순({@link NavigableMap})</b> — 마지막 키가 곧 '앱이 보는 오늘'(응답의 그날 누적)이고,
     * 이벤트 로그도 시간순으로 남는다.
     *
     * <p>일시정지 공백은 여기서 알 수 없다 — 앱이 날짜별 집중초를 실어 보내면 그쪽이 우선한다
     * ({@link #resolveSecondsByDate}). 이 벽시계 분할은 그 값의 <b>상한</b>이자 구버전 앱 폴백이다.
     *
     * <p>경계: 정확히 자정에 끝나는 세션은 그 시각이 속한 <b>전날</b> 조각으로 끝난다(초 0짜리 다음날 조각을
     * 만들지 않는다). 같은 날 안에서 끝나는 세션은 조각 1개로 종전과 동일하다.
     *
     * <p><b>총합은 floor, 경계 배분은 올림 (코드리뷰 3차 ④·4차 ①·5차 ⑤)</b>: 세 조건을 동시에 만족해야 한다.
     * <ol>
     *   <li>구간 총합 = floor(duration) — 599.5초짜리 같은 날 세션이 600초가 돼 10분 문턱을 잘못 통과하면 안 된다.</li>
     *   <li>조각 합 == 총합 — 조각마다 {@code Duration.getSeconds()} 로 잘라 더하면 양 끝에 밀리초가 있는
     *       구간에서 총합이 1초 준다(23:50:00.500~00:10:00.500 = 1200초인데 599+600=1199).</li>
     *   <li>조각(=클라 분포의 상한)이 <b>클라의 tick 경계 규약</b>과 어긋나면 안 된다 — 어긋나면 정상 분포가
     *       클램프되어 초가 유실되고 그날 10분 문턱을 놓친다.</li>
     * </ol>
     * ①은 총합을 {@code Duration.getSeconds()}(floor)로 확정해, ②는 마지막 조각을 총합의 잔여로 둬서 만족한다.
     * ③이 5차 수정점이다: 클라는 tick 1개를 '그 tick 이 덮은 1초의 <b>시작</b> 시각'의 날짜에 센다
     * (앱 blockToday.creditTick). 시작 시각으로부터 k 번째 초는 {@code [start+(k−1)s, start+ks)} 이므로
     * 경계 전 날짜에 속한 초의 개수는 {@code k−1 < Δ} 를 만족하는 k 의 수 = {@code ceil(Δ)}
     * (Δ = 시작→경계 실수 초)다. 반올림이면 위상이 .5 를 넘는 순간(예: 23:50:00.800~00:10:00.800, Δ=599.2)
     * 상한이 599 로 내려앉아 클라의 정당한 600 이 잘렸다 — 그래서 경계 누적은 <b>올림</b>으로 구한다.
     * 총합을 넘지 않게 캡하므로 ①·②는 그대로 유지된다.
     */
    static NavigableMap<LocalDate, Integer> splitByLocalDay(Instant startedAt, Instant endedAt, ZoneId zone) {
        NavigableMap<LocalDate, Integer> secondsByDate = new TreeMap<>();
        // 구간 총합(floor) — 조각들은 이 정수를 나눠 가질 뿐 늘리지 않는다.
        long totalSeconds = Duration.between(startedAt, endedAt).getSeconds();
        Instant cursor = startedAt;
        long creditedSeconds = 0;
        while (true) {
            LocalDate date = cursor.atZone(zone).toLocalDate();
            Instant nextMidnight = date.plusDays(1).atStartOfDay(zone).toInstant();
            // 상한(MAX_SPLIT_DAYS)에 닿으면 남은 구간을 이 조각에 몰아 총합을 보존한다.
            boolean splitHere = nextMidnight.isBefore(endedAt) && secondsByDate.size() < MAX_SPLIT_DAYS - 1;
            Instant sliceEnd = splitHere ? nextMidnight : endedAt;
            // 경계까지의 누적 초(클라 tick 규약 = 올림, 총합 초과 금지)의 차분 = 이 조각 몫.
            // 마지막 조각은 잔여 전부라 조각 합 == 총합.
            long cumulativeSeconds = splitHere
                    ? Math.min(Math.floorDiv(Duration.between(startedAt, sliceEnd).toMillis() + 999, 1000),
                            totalSeconds)
                    : totalSeconds;
            secondsByDate.merge(date, (int) (cumulativeSeconds - creditedSeconds), Integer::sum);
            creditedSeconds = cumulativeSeconds;
            if (!sliceEnd.isBefore(endedAt)) {
                return secondsByDate;
            }
            cursor = sliceEnd;
        }
    }

    /**
     * 통계 귀속용 유효 종료 시각 — 미래 endedAt(클라 시각 위조·시계 오차)을 서버 {@code now} 로 클램프한다.
     *
     * <p>클램프가 없으면 '지금 시작해 내일 끝나는' 위조 세션이 오늘 자정까지의 초를 오늘 조각에 채워
     * 오늘 스트릭·집중목표 지급을 즉시 달성시킨다. 지급 경로({@link #sessionRewardCoins})도 같은 클램프를 한다.
     *
     * <p>⚠️ 저장되는 세션 원본 행(endedAt)은 절대 이 값으로 바꾸지 않는다 — POST 재업로드 중복 검사
     * ({@code existsByUserAndStartedAtAndEndedAtAndStatus})가 '앱이 보낸 값 그대로 저장'을 전제하므로,
     * 저장값을 바꾸면 재전송이 중복 검사를 빠져나가 이중 계상된다. 대신 이 값을
     * {@code focus_sessions.stat_end_at} 에 함께 남겨 조회 집계(by-category)가 조회 시점 now 가 아니라
     * 완료 시점 클램프로 자르게 한다(GROMO-1252 ②).
     */
    private static Instant statEnd(Instant endedAt, Instant now) {
        return endedAt.isAfter(now) ? now : endedAt;
    }

    /**
     * 날짜별 귀속 확정 (GROMO-1252 ① · GROMO-1214 3차 ①) — 날짜별 <b>순수 집중초</b>와 날짜별 방해초.
     *
     * @param focusSeconds       날짜 → 순수 집중초(일시정지 제외). 사전집계 가산분·저장 분포
     *                           ({@code focus_sessions.focus_seconds_by_date})·조회 집계가 전부 이 값을 쓴다.
     * @param distractionSeconds 날짜 → 방해초(조각 길이 비례 배분, 합 = 세션 총 방해초). 벽시계 폴백에서
     *                           집중초를 net 으로 깎는 근거값이다. ⚠️ 지표 컬럼
     *                           ({@code daily_focus_stats.total_distraction_seconds})은 이 배분이 아니라
     *                           <b>시작일에 전량</b> 쌓는다(GROMO-1252 5차 ⑥ 메타데이터 버킷).
     */
    record CreditedByDate(NavigableMap<LocalDate, Integer> focusSeconds,
                          NavigableMap<LocalDate, Integer> distractionSeconds) {
    }

    /**
     * 날짜별 집중 초 귀속 결정 (GROMO-1252 ①) — 앱이 실어 보낸 분포를 검증해 쓰고, 없으면 벽시계 분할로 폴백한다.
     *
     * <p><b>왜 앱 분포가 필요한가</b>: 업로드 구간 [startedAt, endedAt] 엔 일시정지 공백이 섞여 있어 벽시계로
     * 쪼개면 날짜별 몫이 어긋난다 — 23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중은 실제 300/300 인데
     * 벽시계는 600/900 이다. 날짜별 분포를 아는 건 앱뿐이고 업로드엔 두 시각만 실려 있다.
     *
     * <p><b>gross / net 구분 (코드리뷰 3차 ①)</b>: 두 경로의 단위가 다르다.
     * <ul>
     *   <li>앱 분포 = 집중 tick 합 = <b>이미 일시정지가 빠진 net</b>. 여기서 방해초를 또 빼면 이중 차감이다
     *       (30분 집중 + 30분 일시정지 → 조각 1800 − 방해 1800 = 0초 기록, 스트릭·목표 보상 증발).</li>
     *   <li>벽시계 분할 = 일시정지를 포함한 <b>gross</b>. 이쪽만 조각 몫의 방해초를 뺀다.</li>
     * </ul>
     * 어느 경로든 이 메서드가 <b>net 으로 통일해서</b> 돌려주므로, 호출측(사전집계·저장 분포)은 다시 빼지 않는다.
     *
     * <p><b>위조 방어(무검증 수용 금지)</b>: 클라 값은 두 규칙으로 걸러진다.
     * <ul>
     *   <li>세션 구간과 겹치지 않는 날짜는 폐기 — 벽시계 분할에 없는 날짜 키는 그 세션이 닿지 않은 날이다.</li>
     *   <li>각 날짜의 값은 <b>그 날짜의 벽시계 몫 이하</b>로 클램프 — 한 날짜에 그 세션이 머문 시간보다 많은
     *       집중초는 존재할 수 없다. 날짜별 상한이라 총합도 자동으로 세션 구간을 넘지 못한다.</li>
     * </ul>
     * 필터 후 남는 게 없으면(전부 위조) 폴백과 같은 벽시계 분할로 돌아간다 — 위조로 얻을 게 없고(상한이 곧
     * 벽시계), 클라 버그로 통계가 통째로 증발하지도 않는다.
     *
     * @param clientByDate 앱이 보낸 로컬 날짜 → 집중 초 (null·빈 맵이면 벽시계 분할)
     */
    static CreditedByDate resolveSecondsByDate(Instant startedAt, Instant statEnd, ZoneId zone,
                                               Map<LocalDate, Integer> clientByDate,
                                               int totalDistractionSeconds) {
        // 구간이 통째로 미래(startedAt > statEnd)면 조각을 하나도 만들지 않는다(음수 초 방지).
        if (statEnd.isBefore(startedAt)) {
            return new CreditedByDate(Collections.emptyNavigableMap(), Collections.emptyNavigableMap());
        }
        NavigableMap<LocalDate, Integer> wallClock = splitByLocalDay(startedAt, statEnd, zone);
        NavigableMap<LocalDate, Integer> clientNet = verifiedClientSeconds(wallClock, clientByDate);
        // 방해초는 타임스탬프가 없어 날짜별로 정확히 못 나눈다 — 조각 길이에 비례 배분한다.
        // 집중초에서 빼는지와 무관하게 지표 컬럼은 같은 규칙으로 쌓는다.
        NavigableMap<LocalDate, Integer> distraction =
                allocateByShare(clientNet != null ? clientNet : wallClock, totalDistractionSeconds);
        if (clientNet != null) {
            return new CreditedByDate(clientNet, distraction);
        }
        NavigableMap<LocalDate, Integer> net = new TreeMap<>();
        wallClock.forEach((date, seconds) ->
                net.put(date, Math.max(0, seconds - distraction.getOrDefault(date, 0))));
        return new CreditedByDate(net, distraction);
    }

    /** 앱 분포 검증 — 벽시계 몫으로 클램프한 결과. 쓸 값이 하나도 없으면 {@code null}(= 벽시계 폴백). */
    private static NavigableMap<LocalDate, Integer> verifiedClientSeconds(
            NavigableMap<LocalDate, Integer> wallClock, Map<LocalDate, Integer> clientByDate) {
        if (clientByDate == null || clientByDate.isEmpty()) {
            return null;
        }
        NavigableMap<LocalDate, Integer> verified = new TreeMap<>();
        for (Map.Entry<LocalDate, Integer> entry : clientByDate.entrySet()) {
            Integer cap = entry.getKey() != null ? wallClock.get(entry.getKey()) : null;
            Integer seconds = entry.getValue();
            if (cap == null || seconds == null || seconds <= 0) {
                continue;
            }
            verified.put(entry.getKey(), Math.min(seconds, cap));
        }
        return verified.isEmpty() ? null : verified;
    }

    /**
     * 총량을 조각 길이에 비례 배분한다 — 마지막 조각이 반올림 잔여를 흡수해 총합이 정확히 보존된다
     * (조각이 1개면 곧 전량). 가중치 합이 0 이면 전량을 마지막 조각에 몰아 총합만 지킨다.
     */
    private static NavigableMap<LocalDate, Integer> allocateByShare(NavigableMap<LocalDate, Integer> slices,
                                                                    int total) {
        NavigableMap<LocalDate, Integer> allocated = new TreeMap<>();
        if (slices.isEmpty()) {
            return allocated;
        }
        int totalWeight = slices.values().stream().mapToInt(Integer::intValue).sum();
        int assigned = 0;
        int index = 0;
        for (Map.Entry<LocalDate, Integer> slice : slices.entrySet()) {
            index++;
            int share = index == slices.size()
                    ? total - assigned
                    : (totalWeight <= 0 ? 0 : (int) ((long) total * slice.getValue() / totalWeight));
            allocated.put(slice.getKey(), share);
            assigned += share;
        }
        return allocated;
    }

    /**
     * 확정 분포를 {@code focus_sessions.focus_seconds_by_date}(jsonb) 저장 형태로 바꾼다 (GROMO-1252 3차 ①).
     *
     * <p>키를 ISO 문자열("YYYY-MM-DD")로 낮추는 이유: jsonb 매핑은 Hibernate 기본 ObjectMapper 를 쓰는데
     * JavaTimeModule 이 없어 {@code LocalDate} 맵 키를 직렬화/역직렬화하지 못한다. 조각이 없으면
     * null 을 저장해 레거시 row 와 같은 폴백 경로를 타게 한다.
     */
    private static Map<String, Integer> toStoredSecondsByDate(NavigableMap<LocalDate, Integer> secondsByDate) {
        if (secondsByDate.isEmpty()) {
            return null;
        }
        Map<String, Integer> stored = new LinkedHashMap<>();
        secondsByDate.forEach((date, seconds) -> stored.put(date.toString(), seconds));
        return stored;
    }

    /**
     * 라이브 집중 세션 시작(GROMO-610) — startedAt 만 기록한 진행 중(endedAt NULL) 세션을 INSERT.
     * 통계·스트릭은 종료(PATCH) 시점에 귀속하므로 여기서는 건드리지 않는다.
     *
     * <p><b>close-then-open (GROMO-1287)</b> — 새 마커를 열기 전에 같은 유저의 열린 마커를 원자적으로
     * 마감한다. 종전엔 기존 마커를 조회조차 하지 않고 무조건 INSERT 해서 "유저당 라이브 마커 1개"를
     * 강제하는 것이 아무것도 없었다. 고아 마커가 남으면 ① 친구·리그 {@code isFocusing} 이 최대 12시간
     * (orphan 스윕 주기) 참으로 남고 ② {@code existsActiveOverlappingWindow}(GROMO-1413) 정산 대기
     * 가드가 계속 참이라 그 회차 정산이 최대 12시간 밀리고 최악의 경우 24h 자동 환불로 내기가 무효화된다.
     *
     * <p>마감 status 를 {@code AUTO_CLOSED} 로 쓰는 이유(신규 상태값을 만들지 않은 이유)는
     * {@link FocusSessionRepository#autoCloseOpenMarkersOf} 주석 참고 — 요약하면 집계 제외 관례
     * (NOT IN(CANCELED, AUTO_CLOSED))와 PATCH 409 분기(→ SESSION_DISCARDED → 앱 POST 폴백)가
     * 이미 이 값에 배선돼 있어 <b>유저 보상 경로가 보존</b>되기 때문이다.
     *
     * <p>{@code endedAt} 은 서버 수신 시각({@code now}) 이다. 새 마커의 {@code startedAt} 은 클램프 창
     * (과거 5분)만큼 과거일 수 있어 구 마커의 {@code startedAt} 보다 앞설 수 있지만, {@code now} 는
     * 어떤 마커의 {@code startedAt}(생성 시점에 미래 0분으로 클램프됨)보다도 항상 뒤라 역전이 없다.
     *
     * <p>동시 start 직렬화 — 여기서만 users 행을 <b>배타</b> 락으로 잡는다({@link #requireActiveUserForUpdate}).
     * 마커가 아직 하나도 없을 때는 잠글 마커 행 자체가 없어 users 행이 유일한 직렬화 지점이고, 직렬화가
     * 없으면 동시 요청 2건이 각자 "열린 마커 없음"을 보고 둘 다 INSERT 해 불변식이 깨진다.
     * <b>이 락이 불변식의 실제 강제 지점</b>이다 — DB 부분 유니크 인덱스는 롤백 안전 때문에 후속 티켓으로
     * 미뤘고(V47 주석 참고), 열린 마커를 만드는 경로가 이 메서드 하나뿐이라 이 조합으로 성립한다.
     * 이 락은 아래 <b>startedAt 단조성</b> 판정의 전제이기도 하다 — 직렬화가 없으면 두 요청이 서로의
     * 마커를 못 보고 판정 자체가 성립하지 않는다.
     *
     * <p><b>순서 역전 방어(GROMO-1287, codex 리뷰 P1)</b>. 앱의 {@code startLiveSession} 은 반환값이 없어
     * await 되지 않는다. 백그라운드 복귀 리플레이가 휴식→집중 경계마다, 그리고 크레딧 상한 처리에서
     * 연달아 start 를 쏘면 여러 요청이 동시에 날아가고 <b>논리적으로 더 이른 요청이 나중에 도착</b>할 수
     * 있다. 무조건 close-then-open 하면 그 늦은 요청이 방금 열린 최신 마커를 {@code AUTO_CLOSED} 로 닫고
     * 자기 마커를 라이브로 만든다 — 앱은 최신 논리 요청의 id 를 계속 참조하므로 종료가 POST 폴백으로
     * 새고, 뒤늦게 생긴 마커는 12h 스윕까지 '집중 중'으로 남는다. 불변식을 세우기 전에는 마커가 여럿
     * 남아 소비처의 "최신 우선" 정렬이 오히려 최신을 지켜줬으므로, 이 방어는 <b>불변식과 한 몸</b>이다.
     * <ul>
     *   <li>열린 마커의 {@code startedAt} 보다 <b>엄격히 늦은</b> 요청만 회전으로 인정한다.</li>
     *   <li>그렇지 않으면 <b>기존 마커를 건드리지 않고 {@code sessionId = null} 을 돌려준다</b>
     *       (= "이 요청으로는 마커를 만들지 않았다"). 자세한 이유는 아래 별도 문단.</li>
     *   <li>동률(같은 시각)도 마찬가지다 — 회전해 봐야 같은 시각의 새 행일 뿐인데, 먼저 응답을 받아
     *       id 를 기록한 앱이 닫힌 마커를 들게 된다.</li>
     * </ul>
     *
     * <p><b>왜 기존 마커 id 를 재사용하면 안 되는가(codex 리뷰 P1 3차 — 적립 유실)</b>. 역순 도착한
     * start 들은 <b>서로 다른 집중 블록</b>이다. 그 전부에 같은 마커 id 를 주면 각 블록의
     * {@code settleFocusBlock} 이 같은 id 로 PATCH 를 보내고, 먼저 도착한 하나만 적립된다 — 나머지는
     * {@code SESSION_ALREADY_ENDED} 를 받는데 앱은 <b>그 코드에서만 POST 폴백을 하지 않는다</b>
     * ({@code uploadFocusBlock.ts}: 이미 커밋된 마커로 보고 종결). 그래서 그 블록의 집중 시간과 코인이
     * <b>영구 유실</b>된다. 서버는 재전송(같은 블록)과 역순 도착(다른 블록)을 구분할 수단이 없으므로,
     * "id 를 재사용해도 멱등"이라는 전제 자체가 성립하지 않는다 — 재사용을 아예 하지 않는다.
     *
     * <p><b>왜 4xx 가 아니라 {@code sessionId = null} 인가</b>. 앱은 이미 "마커 없는 블록"을 1급 경로로
     * 갖고 있다 — {@code uploadFocusBlock(sessionId: null)} 은 PATCH 를 통째로 건너뛰고 곧바로
     * {@code POST /focus-session} 으로 적립한다(오프라인 시작 블록이 쓰는 그 길). 없던 길을 내는 게
     * 아니라 있는 길로 보내는 것이라 <b>앱 수정 없이 하위호환</b>이다. 4xx 를 주면 앱이
     * {@code logFocusMarkerStartFailed} 만 남기는데, 그때도 POST 로 가긴 하지만 실패로 계측돼 지표가
     * 오염되고 정상 동작을 에러로 표현하게 된다.
     *
     * <p><b>이 블록이 잃는 것(수용, GROMO-1214 와의 관계)</b>: 마커를 안 거치므로 1214 가 세운
     * "서버 발급 마커를 거쳐야만 지급" 성질을 잃고 구 POST 경로(클라 신뢰)로 적립된다. 오프라인 시작
     * 블록이 이미 지고 있는 <b>기존 트레이드</b>이지 새 구멍이 아니고, 대안은 그 블록의 시간·코인을
     * 통째로 잃는 것이라 이쪽을 받는다. 라이브 표시도 잃지만 이 분기가 걸리는 블록은 전부 <b>과거
     * 블록</b>(리플레이 버스트·도착 역전)이라 실시간 표시 가치가 애초에 없고, 살아남는 마커는 언제나
     * 최신 것이다.
     *
     * <p><b>순서 판정은 클램프 <em>이전</em> 클라 시각으로 한다(codex 리뷰 P1 2차)</b>. 저장값은 종전대로
     * {@link #clampToServerNow} 를 거치지만, 그 클램프 값을 판정에 쓰면 규칙이 무력화된다 — 5분 넘게
     * 백그라운드에 있다가 여러 블록을 리플레이하면 과거 경계들이 <b>전부 각 요청의 서버 {@code now} 로
     * 치환</b>돼 논리적 순서 정보가 사라지고 도착 순서만 남는다. 그러면 늦게 도착한(논리적으로 이른)
     * 요청의 값이 오히려 더 커서 단조성을 통과해 최신 마커를 닫는다. 원래 요청 시각을 순서 키로 쓰면
     * 그 버스트의 요청들이 전부 "이미 열린 마커(= 서버 now)보다 이르다"로 판정돼 <b>마커 1개로 수렴</b>
     * 한다 — 첫 요청만 마커를 갖고, 나머지 블록은 {@code sessionId = null} 을 받아 POST 로 적립한다.
     *
     * <p><b>클램프 이전 값을 판정에 써도 안전한 이유</b>: 이 값은 <b>저장되지 않고</b> 비교에만 쓰인다
     * (GROMO-1214 의 위조 방어 = "저장·집계에 클라 시각이 들어가지 않는다"는 그대로다). 조회
     * ({@code findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc})와 마감
     * ({@code autoCloseOpenMarkersOf}) 모두 {@code user} 로 스코프되므로 남의 마커에는 닿지 않는다.
     * 그래서 위조로 할 수 있는 최대치는 <b>자기 마커를 자기가 닫는 자해</b>(회전 강제) 또는
     * <b>자기 마커 회전을 막는 것</b>이고, 둘 다 통계·코인·정산 금액을 움직이지 못한다 — 마감된 마커는
     * {@code AUTO_CLOSED}(집계 제외)이고 종료 경로는 POST 폴백으로 시간·코인을 그대로 회수한다.
     *
     * <p><b>알려진 한계(수용)</b> — 근본 원인은 앱이 순서를 보장하지 않는 것이라(startLiveSession 이
     * void 이고 요청에 시퀀스·nonce 도 없다) 서버 단독 완전 봉쇄는 불가능하다. 별도 순서 키를 받으려면
     * 앱 변경이 필요해 이 티켓 범위 밖이다. 남는 것:
     * <ul>
     *   <li>기기 시계가 크게 <b>앞선</b> 클라 — 매 start 가 판정을 통과해 회전 churn 이 생긴다.
     *       크게 <b>뒤처진</b> 클라 — 열린 마커가 있는 동안 새 마커가 계속 안 생기고 그 블록들이 POST
     *       경로로 간다(마커가 PATCH·취소로 닫히면 다음 start 가 정상 생성). 어느 쪽도 저장값은
     *       클램프되므로 통계·보상과 무관하고 영향이 그 유저 자신에 한정된다.</li>
     *   <li>규칙이 보수적이라(이르거나 같으면 회전 안 함) 드물게 논리적으로 더 늦은 요청이 마커를
     *       못 받을 수 있다. 그 블록도 POST 로 <b>온전히 적립</b>되고, 라이브 마커는 정확히 1개 남는다.</li>
     * </ul>
     * <b>어느 한계에서도 적립은 잃지 않는다</b> — 마커를 못 받은 블록은 항상 POST 경로가 받는다.
     * 라이브 표시 잔여는 {@code FocusSessionOrphanScheduler}(12h 스윕)가 덮는다 — 불변식이 서도
     * 스윕을 남긴 이유다.
     *
     * @param userId 시작 주체. 탈퇴 유저면 404이고, 남의 태그를 지정하면 403
     * @param body   시작 시각·태그·세션 유형. 시작 시각이 [-5분, 0] 창 밖이면 서버 수신 시각으로 대체된다
     * @return 생성된 마커 id 와 <b>서버가 확정한</b> 시작 시각. 이 요청이 이미 열린 마커보다 논리적으로
     *         이르면 마커를 만들지 않고 <b>id 가 null</b> 로 돌아온다 — 그때 앱은 열려 있는 다른 마커 id 를
     *         쓰지 말고 그 블록을 POST 로 올려야 한다(재사용하면 그 블록의 시간·코인이 유실된다)
     */
    @Transactional
    public FocusSessionStartResponse startFocusSession(UUID userId, FocusSessionStartRequest body) {
        User user = requireActiveUserForUpdate(userId);

        // GROMO-1214: 클라 시각 클램프 — 창(과거 5분·미래 0분) 밖이면 서버 수신 시각으로 대체한다.
        Instant now = clock.instant();
        Instant startedAt = clampToServerNow(body.startedAt(), now);
        UserFocusTag tag = resolveOwnedTag(userId, body.focusTagId());

        // GROMO-1287(codex 리뷰 P1): 순서 역전 방어 — 늦게 도착한 '논리적으로 이른' start 는 최신 마커를
        // 닫지 못한다. 순서 키는 **클램프 이전** 클라 시각이다(클램프 값을 쓰면 리플레이 버스트에서 전부
        // now 로 치환돼 판정이 도착 순서로 붕괴한다 — javadoc 참고). 저장은 여전히 클램프 값(startedAt)으로 한다.
        Instant orderKey = body.startedAt() != null ? body.startedAt() : now;
        // 판정에만 쓰는 읽기다(엔티티를 변경하지 않으므로 아래 벌크 UPDATE 와 더티 라이트가 충돌하지 않는다).
        Optional<FocusSession> liveMarker =
                focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(user);
        // ⚠️ 비교 상대는 마커의 **원시** 시각이다(clientStartedAt). startedAt 은 클램프를 거친 값이라,
        //    리플레이 버스트에서 앞선 요청이 now 로 치환돼 저장되면 뒤따르는 요청의 원시 시각이
        //    그보다 과거로 보인다 — 논리적으로 더 늦은 블록이 마커를 못 받고 라이브 표시가 비며
        //    정산 가드도 그 블록을 못 잡는다(codex 리뷰). 레거시·구버전이 만든 행은 null 이라
        //    startedAt 으로 폴백한다 — 그 경우는 종전과 같은 근사치이고, 새로 생기는 마커부터 정확해진다.
        if (liveMarker.isPresent() && !orderKey.isAfter(orderKeyOf(liveMarker.get()))) {
            // 마커를 만들지 않았음을 sessionId=null 로 알린다. **기존 마커 id 를 재사용하면 안 된다** —
            // 역순 도착한 start 들은 서로 다른 블록이라, 같은 id 를 주면 뒤늦은 PATCH 가
            // SESSION_ALREADY_ENDED(앱이 POST 폴백을 하지 않는 코드)를 받아 그 블록의 시간·코인이
            // 영구 유실된다. null 이면 앱이 uploadFocusBlock 의 '마커 없음' 경로로 곧바로 POST 한다.
            // 집중 프레즌스 리스 (GROMO-292) — 마커를 «새로 만들지 않았을 뿐» 이 사람은 집중 중이다.
            // 그 열린 마커의 id 를 싣는다: 값이 세션 id 여야 종료가 「내가 놓은 리스」를 알아본다.
            focusPresencePort.focusStarted(userId, liveMarker.get().getId());
            return new FocusSessionStartResponse(null, startedAt);
        }

        // GROMO-1287: 열린 마커 원자적 마감 — 반드시 INSERT 앞이다. 뽀모도로 마커 회전(앱이 구 마커를
        // 비동기 PATCH 로 마감하며 새 블록을 여는 정상 흐름)에서 구 마커가 아직 열려 있어도 여기서 닫혀
        // "유저당 열린 마커 1개"가 유지된다. (후속 티켓의 부분 유니크 인덱스가 붙으면 이 순서가 곧
        //  유니크 위반 회피 조건이 된다 — 뒤집으면 정상 회전이 500 이 된다.)
        focusSessionRepository.autoCloseOpenMarkersOf(user, now);

        // GROMO-292: 회전에서 «방금 닫은» 이전 마커의 종료도 알린다. 아래 focusStarted 가 어차피 새
        // 세션으로 리스를 덮어쓰지만, 그 쓰기가 한 번 실패하면 키에 이미 닫힌 이전 세션 id 가 남고
        // 그 마커는 고아 스윕 대상도 아니라 아무도 못 지운다. 해제를 먼저 등록해 두면 그 경우에도
        // 리스가 남지 않는다(같은 트랜잭션의 커밋 콜백은 등록 순서대로 돈다).
        liveMarker.map(FocusSession::getId).ifPresent(closed -> focusPresencePort.focusEnded(userId, closed));

        // GROMO-733: focus_type 인입 — null 이면 INFINITE 기본(엔티티 @Builder.Default 정합, 하위호환).
        FocusSession saved = focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .focusTag(tag)
                .focusType(body.focusType() != null ? body.focusType() : FocusType.INFINITE)
                .startedAt(startedAt)
                // 순서 판정 전용 — 저장·집계·보상은 위 startedAt(클램프 값)만 본다.
                .clientStartedAt(body.startedAt())
                .build());

        // 집중 프레즌스 리스 (GROMO-292) — 채팅이 「집중 중엔 못 들어온다」를 판정하는 근거다.
        // 반영은 커밋 이후이고(RedisFocusPresence), 이 트랜잭션이 롤백되면 콜백 자체가 돌지 않는다.
        focusPresencePort.focusStarted(userId, saved.getId());

        return new FocusSessionStartResponse(saved.getId(), saved.getStartedAt());
    }

    /**
     * 마커의 순서 판정 키 — 원시 클라 시각이 있으면 그것, 없으면 저장된 시작 시각.
     *
     * <p>레거시 행과 구버전 이미지가 만든 행은 {@code clientStartedAt} 이 null 이다. 그때는 종전과
     * 같은 근사치(클램프 값)로 떨어지고, 새로 생기는 마커부터 원시끼리 비교돼 정확해진다.
     */
    private static Instant orderKeyOf(FocusSession marker) {
        return marker.getClientStartedAt() != null ? marker.getClientStartedAt() : marker.getStartedAt();
    }

    /**
     * 라이브 집중 세션 종료(GROMO-610) — 진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리.
     * 완료 시점에 통계(DailyFocusStat)·스트릭·이벤트를 귀속시킨다(POST 완료 저장과 동일 로직 공유).
     *
     * <p>종료는 조건부 원자 UPDATE 로 성사시킨다 — 동시 PATCH 두 건이 둘 다 '아직 안 끝남'을 읽고
     * 통계를 두 번 쌓는 걸 막기 위해서다. 성사되지 못하면 상태를 DB 에서 다시 읽어 409 를 두 갈래로 가른다.
     *
     * @param userId 종료 주체. 남의 세션이면 403, 세션이 없으면 404
     * @param body   세션 id·종료 시각·누적 방해 초·(선택)태그 보정·날짜별 집중 초.
     *               종료 시각이 [-5분, 0] 창 밖이면 서버 수신 시각으로 대체되고, 클램프 후에도 시작보다 앞서면 400
     * @return 확정된 구간·길이와 그날 누적·스트릭 인정 여부·지급 코인·잔액
     * @throws com.oneorthree.phone.focus.exception.FocusException 이미 닫힌 마커면 409 —
     *         {@code SESSION_ALREADY_ENDED}(통계·지급이 이미 커밋됐으니 폴백 금지)와
     *         {@code SESSION_DISCARDED}(통계 미반영이라 POST 로 살려 올려야 함)로 갈린다
     */
    @Transactional
    public FocusSessionEndResponse endFocusSession(UUID userId, FocusSessionEndRequest body) {
        User user = requireActiveUser(userId);

        FocusSession session = focusQueryService.getFocusSession(body.sessionId());

        if (session.getUser() == null || !session.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        // GROMO-1214: 클라 시각 클램프 — 창(과거 5분·미래 0분) 밖이면 서버 수신 시각으로 대체한다.
        // 클램프 후에 역전 검사를 한다(과거로 조작된 endedAt 은 now 로 올라가 정상 종료가 된다).
        Instant endedAt = clampToServerNow(body.endedAt(), clock.instant());
        if (endedAt.isBefore(session.getStartedAt())) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);
        }

        // 멱등/이중 완료 방지(TOCTOU 차단) — isEnded() 사전 조회는 동시 PATCH 2건이 둘 다 endedAt==null 을
        // 읽고 통과해 통계를 2번 누적할 수 있다. DB 단일 UPDATE(endedAt IS NULL 조건)로 종료를 원자적으로 성사시키고,
        // 영향 row=0(이미 종료됨)이면 409 로 recordCompletion 을 스킵한다. → 종료를 성사시킨 요청만 통계 1회 반영.
        int updated = focusSessionRepository.endSessionIfActive(body.sessionId(), endedAt);
        if (updated == 0) {
            // GROMO-1214 코드리뷰: 409 의 원인을 구분해 돌려준다. 앱은 PATCH 실패 후 POST 폴백 여부를 이걸로 가른다.
            //   COMPLETED(또는 상태 미상) → SESSION_ALREADY_ENDED: 통계·지급이 이미 커밋됐다. 폴백하면 이중 지급.
            //   CANCELED / AUTO_CLOSED  → SESSION_DISCARDED: 통계에 한 번도 반영되지 않은 마커다
            //       (status NOT IN (CANCELED, AUTO_CLOSED) 집계 관례). 폴백하지 않으면 그 세션 시간이 영구 유실된다.
            // 판정은 위에서 로드한 엔티티가 아니라 DB 재조회(findStatusById)로 한다 — 그 엔티티는 UPDATE 이전
            // 스냅샷이라 동시 취소를 못 보고, 그러면 살릴 수 있는 세션을 ALREADY_ENDED 로 돌려보내 시간이 유실된다.
            // 상태를 못 읽으면(행 소실 등) 이중 지급을 피하는 쪽인 ALREADY_ENDED 로 떨어진다.
            boolean discarded = focusSessionRepository.findStatusById(body.sessionId())
                    .filter(s -> s == FocusSessionStatus.CANCELED || s == FocusSessionStatus.AUTO_CLOSED)
                    .isPresent();
            throw new FocusException(discarded
                    ? FocusErrorCode.SESSION_DISCARDED
                    : FocusErrorCode.SESSION_ALREADY_ENDED);
        }

        UserFocusTag tag = session.getFocusTag();
        if (body.focusTagId() != null) {
            tag = resolveOwnedTag(userId, body.focusTagId());
            session.applyTag(tag);
        }

        // 귀속 날짜 계산(순수 함수)을 지급보다 먼저 끝낸다 — 아래 회차 선잠금이 이 날짜 집합을 쓴다.
        ZoneId zone = ZonePolicy.KST;   // GROMO-1259: 저장축 KST 고정 (N8/FR-19, 해외 유저는 L5 수용)
        Instant statEnd = statEnd(endedAt, clock.instant());
        CreditedByDate credited = resolveSecondsByDate(
                session.getStartedAt(), statEnd, zone, body.focusSecondsByDate(), body.totalDistractionSeconds());

        // 락 순서 고정(계약 §3: 회차 → 지갑) — POST 완료 저장 경로와 동일한 이유다(교착·낙관락 충돌 방지).
        earlyWinConfirmationPort.lockCandidateSessions(userId, credited.focusSeconds().keySet());

        // GROMO-1214: 라이브 마커 종료도 POST 와 동일하게 세션 보상을 지급한다(같은 헬퍼 = 같은 지급률·캡·멱등키).
        // 앱이 cancel+POST 를 PATCH 로 전환하면 이 경로가 유일한 세션 지급처가 된다 — 빠져 있으면 코인이 0이 된다.
        int awardedCoins = creditSessionReward(user, session.getId(), session.getStartedAt(), endedAt,
                body.totalDistractionSeconds());

        // 조건부 UPDATE 로 이미 endedAt 이 채워진 관리 엔티티에 방해 지표·태그를 반영(더티 체킹). recordCompletion 은 1회.
        session.end(endedAt, body.totalDistractionSeconds(), statEnd,
                toStoredSecondsByDate(credited.focusSeconds()));
        RecordCompletionResult result = recordCompletion(user, userId, tag, session.getStartedAt(), endedAt,
                body.totalDistractionSeconds(), zone, credited);
        // 그룹 내기 개인 승리 조기 확정(GROMO-1268, N11) — POST 완료 저장 경로와 동일 배선.
        earlyWinConfirmationPort.confirmWins(userId, credited.focusSeconds().keySet());

        // 종료가 «성사된» 요청만 여기 온다(위 updated==0 은 예외로 빠졌다) — 리스 해제도 여기서 한 번.
        // 그 사이 새 집중이 시작됐다면 리스 주인이 바뀌었으므로 이 해제는 아무것도 지우지 않는다.
        focusPresencePort.focusEnded(userId, body.sessionId());

        long durationSeconds = Duration.between(session.getStartedAt(), endedAt).getSeconds();
        // GROMO-806: 그날 누적·스트릭 인정 여부 / GROMO-1214: 지급 코인·잔액을 응답에 추가(additive, POST 응답과 동일 의미).
        return new FocusSessionEndResponse(session.getId(), session.getStartedAt(), endedAt,
                durationSeconds, body.totalDistractionSeconds(),
                result.dayTotalFocusSeconds(), result.streakQualifiedToday(),
                awardedCoins, result.goalRewardCoins(), currencyLedgerService.balanceOf(user));
    }

    /**
     * 세션 취소(GROMO-733) — 진행 중(endedAt NULL) 세션을 status=CANCELED 로 마감한다.
     *
     * <p>endFocusSession 과 동일한 이중구조: cancelSessionIfActive(조건부 원자 UPDATE, endedAt IS NULL 가드)로
     * 취소를 원자적으로 성사시켜 이중/중복 취소를 멱등 처리하고(영향 row=0 이면 이미 종료/취소 → 409),
     * 성사된 요청만 관리 엔티티 cancel() 더티 flush 로 in-memory 상태를 정합시킨다.
     * 취소는 통계·스트릭 귀속이 없다(완료가 아님).
     *
     * @param userId 요청자. 남의 세션이면 403, 세션이 없으면 404
     * @param body   취소할 마커 id. 취소 시각은 클라가 못 정하고 서버 수신 시각으로 박힌다
     * @throws com.oneorthree.phone.focus.exception.FocusException 이미 종료·취소된 세션이면
     *         {@code SESSION_ALREADY_ENDED}(409)
     */
    @Transactional
    public void cancelFocusSession(UUID userId, FocusSessionCancelRequest body) {
        FocusSession session = focusQueryService.getFocusSession(body.sessionId());

        if (session.getUser() == null || !session.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        // 멱등/이중 취소 방지(TOCTOU 차단) — endedAt IS NULL 조건 단일 UPDATE 로 취소를 원자적으로 성사시키고,
        // 영향 row=0(이미 종료/취소됨)이면 409. → 취소를 성사시킨 요청만 관리 엔티티를 CANCELED 로 정합시킨다.
        Instant canceledAt = clock.instant();
        int updated = focusSessionRepository.cancelSessionIfActive(body.sessionId(), canceledAt);
        if (updated == 0) {
            throw new FocusException(FocusErrorCode.SESSION_ALREADY_ENDED);
        }

        session.cancel(canceledAt);
        // 취소도 집중의 끝이다 — 리스를 남기면 그 사람은 TTL 이 끝날 때까지 채팅에 못 들어간다.
        focusPresencePort.focusEnded(userId, body.sessionId());
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
     * @param now 이 틱의 기준 시각. {@code now - 12h} 이전에 시작한 미종료 세션이 대상이고,
     *            각 세션의 종료 시각은 그 세션의 {@code startedAt + 12h} 로 박힌다(now 가 아니다)
     * <p>GROMO-292: 마감시킨 세션의 <b>집중 프레즌스 리스도 함께 해제</b>한다. 안 그러면 리스는
     * TTL(13h)로만 풀리는데, 그동안 그 사람은 이미 끝난 집중 때문에 채팅에 못 들어간다.
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
            int updated = focusSessionRepository.markAutoClosedIfOpen(session.getId(), cappedEnd);
            closed += updated;

            // GROMO-292: 자동 종료도 «집중의 끝»이다 — 리스를 남기면 그 사람은 TTL(13h)이 다 지날
            // 때까지 채팅에 못 들어간다. 특히 늦게 도착한 start 가 열린 마커 때문에 새 마커를 만들지
            // 않고 반환하는 경로에서도 리스는 그때마다 now+13h 로 갱신되므로, 스윕이 안 지우면
            // 「이미 끝난 집중 때문에 하루 가까이 차단」이 실제로 생긴다.
            // 실제로 마감시킨 세션만 지운다 — 경합으로 유저가 먼저 정상 종료했다면 그쪽이 이미 지웠고,
            // 여기서 또 지우면 그 사이 새로 시작한 집중의 리스를 날린다.
            if (updated > 0 && session.getUser() != null) {
                focusPresencePort.focusEnded(session.getUser().getId(), session.getId());
            }
        }
        return closed;
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 태그 채택·세션 저장/시작/종료처럼
     * users 행은 <b>읽기만 하고</b> 유저 소유 자원(user_focus_tags·focus_sessions·일 집계·코인 지급)을
     * 변경하는 트랜잭션의 요청자 로드. 락 없는 findById 는 계정 탈퇴(UserService.withdraw, 유저 행
     * 배타 락)와 직렬화되지 않아 탈퇴의 정리 스캔 이후·커밋 이전에 낀 변경이 유령(탈퇴자 명의 태그·
     * 세션)으로 남는다. 공유 락끼리는 충돌하지 않아 동시 요청은 그대로 병렬이고, 탈퇴가 먼저
     * 커밋되면 READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForShare(userId);
    }

    /**
     * 활성 검증 + <b>배타</b> 락 (GROMO-1287) — 라이브 마커 시작 전용.
     *
     * <p>{@link #requireActiveUser}(공유 락)와 달리 배타 락을 쓰는 이유는 탈퇴 직렬화가 아니라
     * <b>같은 유저의 동시 start 직렬화</b>다. "유저당 열린 마커 1개" 불변식을 세우려면 close-then-open
     * 전체가 유저 단위로 직렬화돼야 하는데, 열린 마커가 하나도 없는 상태에서는 잠글 {@code focus_sessions}
     * 행이 없다 — 그러면 동시 요청 2건이 각자 마감할 것을 못 찾고 둘 다 INSERT 한다. users 행이 유일한
     * 공통 직렬화 지점이라 여기서 잡는다. DB 부분 유니크 인덱스가 붙기 전(후속 티켓)에는 <b>이 락이
     * 불변식의 유일한 강제 지점</b>이고, 붙은 뒤에는 유니크 위반 500 을 예방하는 지점이 된다.
     *
     * <p>승급 교착 없음(UserRepository "락 선택 원칙") — 트랜잭션 시작 직후 <b>처음부터</b> 배타 락을
     * 잡으며, 같은 트랜잭션에서 공유 락을 먼저 잡는 경로가 없다. 잠금 순서도 기존 규율
     * (users → focus_sessions → 지갑 → daily_focus_stats) 그대로다.
     */
    private User requireActiveUserForUpdate(UUID userId) {
        return userQueryService.getCallerForUpdate(userId);
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
     * <p><b>GROMO-1252 — 자정 분할</b>: 날짜별 조각({@code secondsByDate} — 앱 분포 또는 벽시계 분할,
     * {@link #resolveSecondsByDate})으로 나눠 적립한다. 분할되는 것과 안 되는 것:
     * <ul>
     *   <li>날짜별로 나눔: {@code totalFocusSeconds}, 목표 달성 판정·지급(멱등키가 날짜별이라 어제·오늘
     *       둘 다 채우면 양쪽 다 지급), 스트릭(그 날짜 누적이 10분 이상인 날만 인정 — 쪼갠 뒤 미달이면 미인정)</li>
     *   <li>나누지 않음: 세션 원본 행(1건 유지 → 재업로드 멱등 그대로), 세션 보상 코인(멱등키가 세션 기준),
     *       {@code sessionCount}·{@code totalDistractionSeconds}(타임스탬프가 없어 쪼갤 수 없다) → 시작일에만</li>
     * </ul>
     *
     * <p><b>메타데이터 버킷 = 시작일 (코드리뷰 5차 ⑥)</b>: 클라 분포는 그날 tick 이 하나도 없으면 시작일 키를
     * <b>생략</b>한다(23:50 시작 → 자정 넘겨 00:10 첫 tick = 다음날 키만). 그래서 '첫 조각'을 시작일로 보면
     * 세션 1건과 방해초 전량이 다음날에 붙어 히트맵이 세션을 틀린 날짜로 표시했다. 이제 버킷을
     * {@code startedAt} 에서 직접 파생해 집중초 조각과 <b>따로</b> upsert 한다 — 그 결과 시작일에
     * {@code totalFocusSeconds = 0, sessionCount = 1} 행이 새로 생길 수 있고, 그게 사실 그대로다
     * ("그날 세션을 시작했고 집중초는 자정 뒤에 쌓였다"). 조회는 모두 날짜 격자를 채워 응답하므로
     * (heatmap 은 row 없는 날도 0 셀) 0초 행이 새 셀을 만들지도, 스트릭 판정을 바꾸지도 않는다
     * (스트릭은 {@code user_streaks} 저장값이고 인정 게이트는 10분 누적이다).
     *
     * <p><b>GROMO-1214 코드리뷰 — 방해 초 차감</b>: {@code totalFocusSeconds} 는 <b>순수 집중 시간</b>이다.
     * 차감은 {@link #resolveSecondsByDate} 가 이미 끝냈다 — 여기서 또 빼면 앱 분포(집중 tick 합 = 이미 net)
     * 경로에서 이중 차감이 된다(3차 ①). 이 루프는 날짜별 net 집중초를 그대로 누적할 뿐이고, 지표 컬럼
     * ({@code total_distraction_seconds})은 위 규칙대로 시작일에 전량 쌓는다.
     * 스트릭 10분 게이트·목표 달성 판정은 모두 차감 후(net) 누적으로 이뤄진다.
     *
     * <p><b>미래 endedAt 클램프</b>: 분할 전에 종료 시각을 서버 {@code now} 로 클램프한다(통계 귀속 전용 —
     * 저장된 세션 행은 앱이 보낸 값 그대로). 상세는 아래 구현 주석 참조.
     *
     * @param zone     날짜 버킷 존(KST 고정, GROMO-1259) — 메타데이터 버킷 날짜를 {@code startedAt} 에서 파생한다
     * @param credited 날짜 오름차순 net 집중초 + 날짜별 방해초(호출부가 {@link #resolveSecondsByDate} 로 만든다)
     * @return 종료일(마지막 조각)의 누적 집중 초와 스트릭 인정 여부(응답 필드용, GROMO-806),
     *         그리고 이 세션이 유발한 목표 지급액 합
     */
    private RecordCompletionResult recordCompletion(User user, UUID userId, UserFocusTag tag,
                                  Instant startedAt, Instant endedAt, int totalDistractionSeconds,
                                  ZoneId zone, CreditedByDate credited) {
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

        // ── DailyFocusStat upsert: statDate(KST 고정 날짜 버킷, GROMO-803·1259) 기준 (user, date) 멱등 누적 ──
        // GROMO-1252: 자정을 걸친 세션은 날짜별 조각으로 나눠 각 날짜에 가산한다. 오름차순 순회 —
        // 이벤트 로그가 시간순으로 남는다.

        // 집중 목표 달성 지급액 — 아래 false→true 전이에서만 채워진다(전이 없으면 0). 날짜별 멱등키라 조각마다 가능.
        int goalRewardCoins = 0;
        // 응답 필드는 마지막(가장 늦은) 조각 = 종료일 기준 — 앱이 보는 "오늘" 누적.
        int dayTotalFocusSeconds = 0;
        boolean streakQualifiedToday = false;
        // 세션 메타데이터(sessionCount·방해초)가 붙을 날짜 = 세션 시작일(위 '메타데이터 버킷').
        LocalDate metaDate = statDate(startedAt, zone);
        // upsert 대상 = 집중초 조각 날짜 ∪ 시작일. 조각이 하나도 없는 구간(구간 전체가 미래인 위조 세션 —
        // resolveSecondsByDate 가 빈 맵)은 종전대로 아무 행도 만들지 않는다.
        NavigableSet<LocalDate> statDates = new TreeSet<>(credited.focusSeconds().keySet());
        if (!statDates.isEmpty()) {
            statDates.add(metaDate);
        }
        // 스트릭 인정 날짜는 모아 두었다가 한 번에 넘긴다 (GROMO-1252 3차 ③) — 한 세션이 기여한 여러 날짜를
        // 낱개로 호출하면 소급 방향에서 오래된 쪽이 유실된다(어느 날짜부터 반영해야 하는지는
        // lastSessionDate 를 아는 UserStreakService 만 판단할 수 있다).
        List<LocalDate> streakQualifiedDates = new ArrayList<>();

        for (LocalDate statDate : statDates) {
            // GROMO-642: 초 단위 누적(세션별 분 내림 제거 — 30초×10=300초 정확). goal(분)은 *60 초로 비교.
            // 시작일에 tick 이 없으면(자정 직전 시작 → 첫 tick 은 다음날) 이 날 조각은 없다 — 0초 가산.
            // GROMO-1214 3차 ①: 이 값은 이미 방해초가 빠진 net 이다(리졸버가 경로별로 처리) — 여기서 또 빼지 않는다.
            int addedSeconds = credited.focusSeconds().getOrDefault(statDate, 0);
            // 세션 1건은 어디까지나 1건 — 시작일에만 계수한다. 방해 초도 타임스탬프가 없어
            // 조각에 배분할 수 없으므로 시작일에 전량 귀속한다(GROMO-1252).
            boolean isMetaDate = statDate.equals(metaDate);
            int addedSessionCount = isMetaDate ? 1 : 0;
            int addedDistractionSeconds = isMetaDate ? totalDistractionSeconds : 0;

            // UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
            // INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
            // GROMO-806: 스트릭 게이트·응답 필드용 — 이 조각 반영 후 그날 누적 집중 초.
            int sliceDayTotal;
            Optional<DailyFocusStat> existingStat = dailyFocusStatRepository.findByUserAndDateForUpdate(user, statDate);
            if (existingStat.isPresent()) {
                // 기존 row 누적 (+= 방식) — 더티 체킹으로 반영됨, 별도 save() 불필요
                DailyFocusStat stat = existingStat.get();
                stat.setTotalFocusSeconds(stat.getTotalFocusSeconds() + addedSeconds);
                stat.setSessionCount(stat.getSessionCount() + addedSessionCount);
                stat.setTotalDistractionSeconds(stat.getTotalDistractionSeconds() + addedDistractionSeconds);
                sliceDayTotal = stat.getTotalFocusSeconds();
                // isFocusTimeGoalAchieved: 이미 달성(true)이면 재판정 불필요 — 플래그 단방향이므로 조기 스킵
                if (!stat.isFocusTimeGoalAchieved()) {
                    // GROMO-1049: 그날(statDate)에 유효했던 목표로 판정·지급한다 — 어제 세션을 오늘 올릴 때
                    // 오늘 바뀐 목표로 재단되던 문제. 판정과 금액이 같은 goal 을 쓰므로 여기 한 곳이면 정합.
                    int goal = userQueryService.findFocusTimeSettings(userId)
                            .map(s -> s.goalMinutesOn(statDate)).orElse(0);
                    // (long) 승격 — int 곱은 goal 이 3천5백만 분을 넘으면 음수로 뒤집혀 0초 세션도 달성이 된다.
                    if (goal > 0 && stat.getTotalFocusSeconds() >= (long) goal * 60) {
                        stat.setFocusTimeGoalAchieved(true);
                        // false→true 전이 순간 1회 발행 — 영속 플래그가 하루 1회를 보장 (GROMO-395)
                        logDailyFocusGoalAchieved(statDate, stat.getTotalFocusSeconds() / 60, goal);
                        goalRewardCoins += creditFocusGoal(user, userId, goal, statDate);
                    }
                }
            } else {
                // INSERT 경로: isFocusTimeGoalAchieved 판정을 builder에 포함시켜 INSERT 쿼리 1회로 줄임
                // UserFocusTimeSettings row 없거나 goal=0이면 플래그 false 유지
                int goal = userQueryService.findFocusTimeSettings(userId)
                        .map(s -> s.goalMinutesOn(statDate)).orElse(0);
                boolean goalAchieved = goal > 0 && addedSeconds >= (long) goal * 60;
                dailyFocusStatRepository.save(DailyFocusStat.builder()
                        .user(user)
                        .date(statDate)
                        .totalFocusSeconds(addedSeconds)
                        .sessionCount(addedSessionCount)
                        .totalDistractionSeconds(addedDistractionSeconds)
                        .isFocusTimeGoalAchieved(goalAchieved)
                        .build());
                sliceDayTotal = addedSeconds;
                if (goalAchieved) {
                    // 신규 row 가 곧바로 달성 = false→true 전이와 동일 — 1회 발행 (GROMO-395)
                    logDailyFocusGoalAchieved(statDate, addedSeconds / 60, goal);
                    goalRewardCoins += creditFocusGoal(user, userId, goal, statDate);
                }
            }

            // GROMO-806: 스트릭 인정 게이트 — 그날 누적 집중이 STREAK_MIN_SECONDS(10분) 이상일 때만 갱신한다.
            // (예: 5분+6분 → 1회차 누적 300초<600 미갱신, 2회차 누적 660초>=600 갱신. 이미 인정된 날 재호출은
            //  기존 same-day 멱등이 무변화를 보장.) 세션 저장·일별 집계와 같은 트랜잭션(원자적),
            //  날짜 기준 동일(KST 고정 날짜, GROMO-803·1259).
            // GROMO-1252: 판정은 '쪼갠 뒤' 그 날짜 누적 기준 — 23:55~00:05 처럼 양쪽 다 5분이면 양쪽 다 미인정.
            boolean sliceQualified = sliceDayTotal >= STREAK_MIN_SECONDS;
            if (sliceQualified) {
                streakQualifiedDates.add(statDate);
            }
            dayTotalFocusSeconds = sliceDayTotal;
            streakQualifiedToday = sliceQualified;
        }

        if (!streakQualifiedDates.isEmpty()) {
            userStreakService.updateOnSessionComplete(user, streakQualifiedDates);
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
        ZoneId zone = ZonePolicy.KST;   // GROMO-1259: 저장축 KST 고정 (N8/FR-19, 해외 유저는 L5 수용)
        LocalDate today = LocalDate.ofInstant(clock.instant(), zone);
        // 지급 창 = [어제, 오늘]. 오래된 과거뿐 아니라 미래 날짜(endedAt 위조)도 거부한다 — 하한만 두면
        // 미래 날짜마다 위조 세션을 심어 채굴할 수 있다(코드리뷰 R3).
        if (statDate.isBefore(today.minusDays(1)) || statDate.isAfter(today)) {
            return 0;
        }
        // 목표치 상한 방어(코드리뷰 R4) — 비현실적 목표(예: Integer.MAX_VALUE)는 달성 판정의 goal*60 이
        // 32비트 오버플로로 음수가 돼 빈 세션도 '달성'으로 오판정될 수 있다. 현실 최대(24h)를 넘으면 지급하지 않는다.
        if (goalMinutes > 24 * 60) {
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
     * @param dayTotalFocusSeconds  이 세션 반영 후 <b>종료일</b> 누적 집중 초 (자정 분할 시 마지막 조각의 날짜)
     * @param streakQualifiedToday  종료일 누적이 스트릭 인정 기준(10분) 이상이라 스트릭을 갱신했는지
     * @param goalRewardCoins       이 세션으로 집중 목표를 처음 달성(false→true)했을 때의 지급액 합
     *                              (전이 없으면 0. 자정 분할 시 어제·오늘 양쪽 지급의 합일 수 있다)
     */
    public record RecordCompletionResult(int dayTotalFocusSeconds, boolean streakQualifiedToday,
                                         int goalRewardCoins) {
    }

    /** 일일 집중 목표 달성(false→true 전이) 이벤트 발행 — date 는 ISO(KST 고정 날짜, GROMO-803·1259). */
    private void logDailyFocusGoalAchieved(LocalDate statDate, int totalFocusMinutes, int goalMinutes) {
        userActivityEventLogger.log(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED, Map.of(
                "date", statDate.toString(),
                "total_focus_minutes", totalFocusMinutes,
                "goal_minutes", goalMinutes));
    }

    /**
     * 탈퇴자의 집중 세션을 익명화한다 (GROMO-635 · 이동 GROMO-1656).
     *
     * <p>행을 지우지 않고 {@code user_id} 만 끊는다 — 세션은 그룹 내기 판정·통계 집계의 근거라
     * 지우면 남은 사람들의 이력이 함께 무너진다. 참조가 끊긴 행은 조회 경로에서 자연히 빠진다
     * ({@code user} 가 non-null 인 쿼리들이 걸러 낸다).
     *
     * <p>종전엔 {@code UserService.withdraw} 가 {@code FocusSessionRepository} 를 직접 주입해
     * 불렀다. 집중 이력을 익명화하는 방법은 focus 가 알아야 하므로 여기로 옮겼다 —
     * 쿼리도 시점도 그대로이고, 호출부의 트랜잭션에 편승한다.
     *
     * <p><b>호출 시점 제약</b>: 그룹 내기의 판정 근거 박제({@code GroupBetService
     * .freezeEvidenceForAccountErasure})가 이 익명화 <b>앞</b>에 끝나 있어야 한다 — 박제는 아직
     * 살아 있는 집중 기록을 읽는다.
     *
     * @param userId 탈퇴 중인 유저
     */
    @Transactional
    public void anonymizeWithdrawnUser(UUID userId) {
        focusSessionRepository.nullifyUser(userId);
    }

}
