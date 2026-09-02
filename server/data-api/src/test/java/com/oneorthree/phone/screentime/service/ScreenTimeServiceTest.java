package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.currency.support.CurrencyRewardPolicy;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ScreenTimeServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private DailyScreenTimeStatRepository dailyScreenTimeStatRepository;

    @Mock
    private ScreenTimeNotificationPort notificationPort;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    @Mock
    private CurrencyLedgerService currencyLedgerService;

    // 재시도 래퍼(saveScreenTime)가 위임하는 self 프록시. 본 로직 테스트는 saveScreenTimeTx 를 직접 호출하므로
    // 여기 self 는 재시도 분기 테스트에서만 스텁된다.
    @Mock
    private ScreenTimeService self;

    private ScreenTimeService screenTimeService;

    @BeforeEach
    void setUp() {
        screenTimeService = new ScreenTimeService(userRepository, dailyScreenTimeStatRepository,
                notificationPort, userActivityEventLogger, userScreenTimeSettingsRepository,
                currencyLedgerService, self);
    }

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final String COUNTRY_CODE = "KR";
    private static final ZoneId ZONE = ZoneId.of("Asia/Seoul"); // KR 파생 ZoneId

    // 최종 보고(과거 날짜 추론) 테스트용 — 어제보다도 확실히 과거인 고정 시각(실제 '오늘'과 무관하게 결정론적).
    private static final Instant PAST_AT = Instant.parse("2020-01-01T00:00:00Z");
    private static final LocalDate PAST_DATE = PAST_AT.atZone(ZONE).toLocalDate(); // 2020-01-01

    private User normalUser() {
        return User.builder().id(USER_ID).isGuest(false).countryCode(COUNTRY_CODE).build();
    }

    // 명시적 isFinal — 결정론적. (isFinal=true 는 오늘/과거 무관하게 최종 보고로 처리)
    private ScreenTimeRequest request(Boolean clientAchieved, Integer actualMinutes, Instant reportedAt, Boolean isFinal) {
        return new ScreenTimeRequest(clientAchieved, actualMinutes, reportedAt, isFinal);
    }

    // interim(오늘) 판정 테스트용 — 각 테스트 안에서 호출해 '지금'을 잡는다(Codex P4 결정론). 클래스 로드 시점에 한 번
    // 잡으면 자정 직전 로드 → 자정 후 실행 시 요청 날짜(어제)와 서비스가 Instant.now() 로 계산하는 today 가 어긋나
    // interim 이 final 로 추론돼 flake 가 난다. 요청 reportedAt 과 서비스 today 를 사실상 같은 순간에 계산하도록 매번 잡는다.
    private Instant todayAt() {
        return Instant.now().truncatedTo(ChronoUnit.SECONDS);
    }

    // 주어진 '지금' 순간을 유저 존 로컬 날짜로 환산 — findByUserAndDate 스텁 날짜와 요청 날짜를 같은 instant 로 맞춘다.
    private LocalDate todayDate(Instant todayAt) {
        return todayAt.atZone(ZONE).toLocalDate();
    }

    // ── 최종 보고: 클라 신뢰 (isFinal=true, GROMO-805) ──────────────────────

    @Test
    @DisplayName("최종 보고(isFinal=true) & 클라 달성=true → 서버가 이견이어도(actual 80>goal 60) 클라 신뢰로 저장 true + 이벤트 + 알림")
    void finalReportTrustsClientAchievedEvenWhenServerWouldDisagree() {
        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        // goal 은 최종 보고 판정에 쓰이지 않는다(클라 신뢰). 스텁하지 않아도 통과해야 정상.

        // 과거 날짜의 목표는 지금과 달랐을 수 있어 서버는 actual>goal 여도 클라의 달성을 신뢰한다.
        screenTimeService.saveScreenTimeTx(USER_ID, request(true, 80, PAST_AT, true));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isTrue();
        // 락 규율 (GROMO-1237): 일 집계 upsert·지급 트랜잭션은 공유 락 활성 조회 — 무락 findById 금지.
        verify(userRepository).findActiveByIdForShare(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
        assertThat(captor.getValue().isScreenTimeFinalized()).isTrue();
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(80);
        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED,
                Map.of("date", PAST_DATE.toString(), "actual_screen_time_minutes", 80));
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("최종 보고(isFinal=true) & 클라 달성=false → 저장 false, 이벤트·알림 미발사")
    void finalReportClientNotAchievedStoresFalseAndNoEvent() {
        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // 클라가 미달성(actual 30 이 goal 이내여도 클라 판정을 신뢰) → 저장 false.
        screenTimeService.saveScreenTimeTx(USER_ID, request(false, 30, PAST_AT, true));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().isScreenTimeFinalized()).isTrue();
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("과거 날짜 보고(reportedAt=과거, isFinal=null) → 최종으로 추론, 클라 달성 신뢰(true) → 저장 true + 이벤트 + 알림")
    void pastDateReportInferredAsFinalUsesClientFlag() {
        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // isFinal 미지정(구버전 앱)이라도 과거 날짜면 마감으로 간주 → 클라 달성 신뢰.
        screenTimeService.saveScreenTimeTx(USER_ID, request(true, 999, PAST_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isTrue();
        assertThat(captor.getValue().isScreenTimeFinalized()).isTrue();
        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED,
                Map.of("date", PAST_DATE.toString(), "actual_screen_time_minutes", 999));
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("과거 날짜 보고(isFinal=null) & 클라 달성=false → 최종 추론이나 미달성이므로 이벤트·알림 미발사")
    void pastDateReportClientNotAchievedNoEvent() {
        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTimeTx(USER_ID, request(false, 10, PAST_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().isScreenTimeFinalized()).isTrue();
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── interim(오늘): total 만 갱신, 달성 flag 미변경 (GROMO-805 후속, Codex 재리뷰) ──

    @Test
    @DisplayName("interim(오늘, isFinal=false): total 만 저장, 신규 row 달성 flag 는 기본값 false, 이벤트·알림 미발사")
    void interimStoresTotalOnlyAndDoesNotSetFlag() {
        User user = normalUser();
        Instant todayAt = todayAt();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate(todayAt)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // 클라가 달성 true 주장해도 interim 은 판정하지 않음 → 신규 row flag 기본값(false).
        screenTimeService.saveScreenTimeTx(USER_ID, request(true, 90, todayAt, false));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(90);
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse(); // interim 은 flag 를 세우지 않음
        assertThat(captor.getValue().isScreenTimeFinalized()).isFalse();
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘) & 기존 row 달성=true → total 만 갱신, 기존 flag(true) 보존, 이벤트·알림 미발사")
    void interimKeepsExistingAchievedFlag() {
        User user = normalUser();
        Instant todayAt = todayAt();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(todayDate(todayAt)).isScreenTimeGoalAchieved(true).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate(todayAt)))
                .willReturn(Optional.of(existing));

        // interim 은 클라 달성=false 여도 기존 flag 를 덮지 않는다(마감만 flag 확정).
        screenTimeService.saveScreenTimeTx(USER_ID, request(false, 45, todayAt, false));

        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(45);
        assertThat(existing.isScreenTimeGoalAchieved()).isTrue(); // 기존 flag 보존
        assertThat(existing.isScreenTimeFinalized()).isFalse();
        verify(dailyScreenTimeStatRepository, never()).save(any());
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘) & actualScreenTimeMinutes null(측정 누락) → total null(미집계) 저장, flag 미설정, 이벤트·알림 미발사")
    void interimNullActualMinutesStoresNullAndNoFlag() {
        User user = normalUser();
        Instant todayAt = todayAt();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate(todayAt)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTimeTx(USER_ID, request(true, null, todayAt, false));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        // GROMO-1267(FR-16): 측정 누락은 0 으로 뭉개지 않고 null(미집계)로 남긴다 — "0분 사용"과 구분.
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isNull();
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().isScreenTimeFinalized()).isFalse();
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── 최종 알림 dedup: 마감 재시도는 재발사하지 않음 (Codex P2) ──────────────

    @Test
    @DisplayName("마감 재시도(이미 달성=true 인 기존 row) → total 만 갱신, 이벤트·알림 재발사 안 함(날짜별 멱등)")
    void finalRetryOnAlreadyAchievedRowDoesNotReemit() {
        User user = normalUser();
        // 첫 마감으로 이미 달성 처리된 기존 row (retry 진입 상태).
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(PAST_DATE).totalScreenTimeMinutes(40)
                .isScreenTimeGoalAchieved(true).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.of(existing));

        // 같은 날짜 마감 재업로드 — wasAchieved=true 이므로 재발사 없음.
        screenTimeService.saveScreenTimeTx(USER_ID, request(true, 55, PAST_AT, true));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();
        assertThat(existing.isScreenTimeFinalized()).isTrue();
        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(55); // total 은 갱신
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── upsert: 기존 레코드 갱신 ────────────────────────────────────────────

    @Test
    @DisplayName("기존 레코드 존재(최종 보고) → 신규 save 없이 필드 업데이트")
    void saveScreenTimeUpdatesExistingRecord() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(PAST_DATE).isScreenTimeGoalAchieved(false).build();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.of(existing));

        screenTimeService.saveScreenTimeTx(USER_ID, request(true, 120, PAST_AT, true));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();     // 최종 보고 → 클라 신뢰
        assertThat(existing.isScreenTimeFinalized()).isTrue();
        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(120);
        verify(dailyScreenTimeStatRepository, never()).save(any());
        verify(notificationPort).notify(USER_ID, true);
    }

    // ── KST 로컬 날짜 환산 (date-bucketing, GROMO-1259 KST 고정) ────────────

    @Test
    @DisplayName("KST 자정 경계 → KST 로컬 날짜로 귀속 (GROMO-1259 저장축 KST 고정)")
    void saveScreenTimeUsesKstForLocalDate() {
        User user = normalUser(); // KR
        // 2020-01-01T15:30:00Z == 2020-01-02 00:30 KST → 로컬 날짜 01-02 (UTC 였다면 01-01 로 오귀속)
        Instant reportedAt = Instant.parse("2020-01-01T15:30:00Z");
        LocalDate kstDate = LocalDate.of(2020, 1, 2);

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, kstDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // 과거 날짜라 최종으로 추론됨(goal 조회 불필요). date-bucketing 만 검증.
        screenTimeService.saveScreenTimeTx(USER_ID, request(false, 60, reportedAt, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
    }

    @Test
    @DisplayName("country_code null 이어도 동일하게 KST 로컬 날짜 (GROMO-1259 — 날짜 축은 country_code 무관)")
    void saveScreenTimeNullCountryStillUsesKst() {
        User user = User.builder().id(USER_ID).isGuest(false).build(); // countryCode null
        // 2020-01-01T15:30:00Z == 2020-01-02 00:30 KST → KST 로컬 날짜 01-02
        Instant reportedAt = Instant.parse("2020-01-01T15:30:00Z");
        LocalDate fallbackDate = LocalDate.of(2020, 1, 2);

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, fallbackDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTimeTx(USER_ID, request(false, 60, reportedAt, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(fallbackDate);
    }

    // ── 에러 케이스 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void saveScreenTimeUserNotFound() {
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> screenTimeService.saveScreenTimeTx(USER_ID, request(true, 100, todayAt(), null)))
                .isInstanceOf(UserException.class);
        verify(dailyScreenTimeStatRepository, never()).save(any());
    }

    // ── 동시성 재시도 래퍼: 레이스 진 요청 흡수 (GROMO-560) ──────────────────

    @Test
    @DisplayName("레이스 진 요청: 첫 saveScreenTimeTx 가 DataIntegrityViolationException → 새 트랜잭션 재시도 1회로 정상 흡수")
    void saveScreenTimeRetriesOnceOnDataIntegrityViolation() {
        ScreenTimeRequest request = request(false, 60, PAST_AT, true);
        // 첫 호출은 유니크 위반, 재시도(승자 row 재조회 present)는 정상.
        willThrow(new DataIntegrityViolationException("UNIQUE(user_id, date)"))
                .willDoNothing()
                .given(self).saveScreenTimeTx(USER_ID, request);

        screenTimeService.saveScreenTime(USER_ID, request);

        // 정확히 1회 재시도 → 총 2회 호출(AuthService 선례).
        verify(self, times(2)).saveScreenTimeTx(USER_ID, request);
    }

    @Test
    @DisplayName("재시도 후에도 DataIntegrityViolationException(현실적 미발생) → 전파(GlobalExceptionHandler 409 폴백)")
    void saveScreenTimePropagatesWhenRetryAlsoFails() {
        ScreenTimeRequest request = request(false, 60, PAST_AT, true);
        // 두 호출 모두 유니크 위반 — catch 는 1회뿐이라 재시도 예외는 전파된다.
        willThrow(new DataIntegrityViolationException("UNIQUE(user_id, date)"))
                .given(self).saveScreenTimeTx(USER_ID, request);

        assertThatThrownBy(() -> screenTimeService.saveScreenTime(USER_ID, request))
                .isInstanceOf(DataIntegrityViolationException.class);
        verify(self, times(2)).saveScreenTimeTx(USER_ID, request);
    }

    // ── 달성 알림·이벤트 커밋 이후 defer (GROMO-560 P2, codex 리뷰) ──────────

    @Test
    @DisplayName("트랜잭션 동기화 활성 시: 달성 이벤트·알림은 커밋 전 발사하지 않고 afterCommit 으로 defer → 정확히 1회")
    void finalAchievementEmissionDeferredUntilAfterCommit() {
        // 실제 트랜잭션(동기화 활성)을 흉내 — 활성 상태에서만 defer 가 동작한다.
        TransactionSynchronizationManager.initSynchronization();
        try {
            User user = normalUser();
            given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
            given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                    .willReturn(Optional.empty());
            given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                    .willAnswer(i -> i.getArgument(0));

            screenTimeService.saveScreenTimeTx(USER_ID, request(true, 80, PAST_AT, true));

            // 커밋 전 — 롤백 시 중복을 막기 위해 아직 발사하지 않는다.
            verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
            verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());

            // 커밋 성공 시뮬레이션(afterCommit) → 정확히 1회 발사.
            List<TransactionSynchronization> syncs = TransactionSynchronizationManager.getSynchronizations();
            syncs.forEach(TransactionSynchronization::afterCommit);

            verify(notificationPort).notify(USER_ID, true);
            verify(userActivityEventLogger).log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED,
                    Map.of("date", PAST_DATE.toString(), "actual_screen_time_minutes", 80));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    /**
     * GROMO-1049: 어제분 마감 지급은 <b>어제 유효했던 목표</b>로 금액을 산정한다.
     *
     * <p>앱은 어제 목표로 달성을 판정하고 그 금액을 축하 모달에 표시하는데, 서버가 현재 목표로 산정하면
     * 목표를 바꾼 다음 날 "보인 금액 ≠ 받은 금액"이 된다.</p>
     */
    @Test
    @DisplayName("목표를 바꾼 다음 날 어제분 마감 → 직전 목표로 지급액을 산정한다")
    void creditsYesterdayGoalUsingPreviousGoal() {
        LocalDate today = LocalDate.now(ZONE);
        LocalDate yesterday = today.minusDays(1);
        Instant yesterdayAt = yesterday.atStartOfDay(ZONE).toInstant();

        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, yesterday)).willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        // 어제까지 목표 180분 → 오늘 60분으로 변경
        UserScreenTimeSettings settings = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(180).build();
        settings.changeGoal(60, today);
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        int expected = CurrencyRewardPolicy.screenTimeGoalReward(180);
        // 두 목표의 지급액이 같으면 이 테스트가 아무것도 검증하지 못한다 — 전제부터 고정한다.
        assertThat(expected).isNotEqualTo(CurrencyRewardPolicy.screenTimeGoalReward(60));

        screenTimeService.saveScreenTimeTx(USER_ID, request(true, 150, yesterdayAt, true));

        verify(currencyLedgerService).credit(user, CurrencyTransactionType.SCREEN_TIME_GOAL, expected,
                "stGoal:" + USER_ID + ":" + yesterday);
    }
}
