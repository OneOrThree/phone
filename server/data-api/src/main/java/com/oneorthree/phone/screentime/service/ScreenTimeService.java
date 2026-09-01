package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.currency.repository.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.currency.support.CurrencyRewardPolicy;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class ScreenTimeService {

    private final UserRepository userRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final ScreenTimeNotificationPort notificationPort;
    private final UserActivityEventLogger userActivityEventLogger;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final CurrencyLedgerService currencyLedgerService;

    /**
     * 자기 자신 프록시 — 동시 첫 저장 유니크 위반 시 새 트랜잭션으로 재시도하기 위함 (@Lazy 로 순환 주입 방지).
     */
    private final ScreenTimeService self;

    public ScreenTimeService(UserRepository userRepository,
                             DailyScreenTimeStatRepository dailyScreenTimeStatRepository,
                             ScreenTimeNotificationPort notificationPort,
                             UserActivityEventLogger userActivityEventLogger,
                             UserScreenTimeSettingsRepository userScreenTimeSettingsRepository,
                             CurrencyLedgerService currencyLedgerService,
                             @Lazy ScreenTimeService self) {
        this.userRepository = userRepository;
        this.dailyScreenTimeStatRepository = dailyScreenTimeStatRepository;
        this.notificationPort = notificationPort;
        this.userActivityEventLogger = userActivityEventLogger;
        this.userScreenTimeSettingsRepository = userScreenTimeSettingsRepository;
        this.currencyLedgerService = currencyLedgerService;
        this.self = self;
    }

    /**
     * 스크린타임 저장 진입점 — 동시성 방어를 위한 얇은 재시도 래퍼(GROMO-560).
     *
     * <p>동시 저장 경쟁(TOCTOU): 같은 (user, date) 로 두 요청이 동시에 도달하면 둘 다
     * {@code findByUserAndDate} 가 empty 로 보여 각각 insert 를 시도 → UNIQUE(user_id, date) 제약으로
     * 한쪽 커밋 시 {@link DataIntegrityViolationException}. 유니크 위반은 flush/커밋 시점에 나 트랜잭션
     * 내부에서 잡을 수 없어, self 프록시로 새 트랜잭션을 열어 1회 재시도한다(재시도 시 승자가 만든 row 가 보여
     * update 분기로 정상 흡수 → 진 요청도 204). 스크린타임은 덮어쓰기라 lost-update 가 없어 비관적 락은 불필요.
     * 래퍼는 트랜잭션에 묶이지 않도록 NOT_SUPPORTED — 재시도 tx 가 첫 tx 롤백과 독립되도록. (AuthService 선례)
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void saveScreenTime(UUID userId, ScreenTimeRequest request) {
        try {
            self.saveScreenTimeTx(userId, request);
        } catch (DataIntegrityViolationException e) {
            // 레이스에서 진 요청 — 승자가 만든 row 로 새 트랜잭션에서 1회 재조회·업데이트(present 분기로 정상 흡수).
            self.saveScreenTimeTx(userId, request);
        }
    }

    /**
     * 스크린타임 저장 본 로직 — self 프록시로 호출돼 매 시도가 독립 트랜잭션이 되도록 public.
     * 순수 upsert 가 아니라 알림 전이(false→true) side-effect 가 있어 native ON CONFLICT 대신 재조회 방식을 쓴다.
     */
    @Transactional
    public void saveScreenTimeTx(UUID userId, ScreenTimeRequest request) {
        // 1. 유저 조회 — 활성 검증 + 공유 락. 외부 래퍼(saveScreenTime)는 NOT_SUPPORTED 라 락은
        //    attempt(saveScreenTimeTx)별 트랜잭션 스코프다(정상 — 재시도마다 새로 잡고 커밋 시 풀린다).
        User user = requireActiveUser(userId);

        // 2. reportedAt → KST 로컬 날짜 환산 (자정 경계 오귀속 방지. GROMO-1259: 저장축 KST 고정)
        LocalDate date = resolveLocalDate(request);

        // 3. 최종 보고 여부 판정 (GROMO-805 후속). 최종 보고 = 명시적 isFinal=true 이거나 과거 날짜 보고(마감은 다음 날 업로드).
        //    앱이 아직 isFinal 을 안 보내도(구버전) 과거 날짜면 마감으로 간주해 알림이 눌리지 않도록 서버가 finality 를 추론한다.
        LocalDate today = Instant.now().atZone(ZonePolicy.KST).toLocalDate();
        boolean finalReport = Boolean.TRUE.equals(request.getIsFinal()) || date.isBefore(today);

        // 4. 총 스크린타임(측정 누락 = null 그대로 저장 — GROMO-1267, FR-16: "0분 사용"과 "미집계"는 다르다.
        //    0 으로 뭉개면 미보고가 "0분 사용 = 챌린지 달성"으로 뒤집힌다) + 클라 달성 결과.
        Integer actualMinutes = request.getActualScreenTimeMinutes();
        boolean clientAchieved = Boolean.TRUE.equals(request.getScreenTimeGoalAchieved());

        // 5. daily_screen_time_stats upsert (user, date) — 멱등.
        //    - interim(오늘, 미마감): total 만 갱신, 달성 flag 는 건드리지 않는다(신규 row 기본값 false, 기존 row flag 보존).
        //      "오늘"은 마감 전까지 달성으로 확정하지 않는다(805 이전 "오늘 미집계"와 동일). 마감만이 달성을 확정한다.
        //    - final(마감): is_screen_time_goal_achieved = 클라 달성 결과(client-trust). 서버는 과거 날짜의 당시 목표를
        //      알 수 없어(현재 목표만 조회 가능) 재판정하면 오귀속되므로 클라를 신뢰한다.
        Optional<DailyScreenTimeStat> existing =
                dailyScreenTimeStatRepository.findByUserAndDate(user, date);
        // 알림 전이 판정을 위해 upsert 로 flag 를 덮기 전의 기존 값을 미리 읽어 둔다.
        boolean wasAchieved = existing.isPresent() && existing.get().isScreenTimeGoalAchieved();
        if (existing.isPresent()) {
            DailyScreenTimeStat stat = existing.get();
            stat.setTotalScreenTimeMinutes(actualMinutes);
            if (finalReport) {
                stat.setScreenTimeGoalAchieved(clientAchieved);
                stat.setScreenTimeFinalized(true);
            }
        } else {
            DailyScreenTimeStat.DailyScreenTimeStatBuilder builder = DailyScreenTimeStat.builder()
                    .user(user)
                    .date(date)
                    .totalScreenTimeMinutes(actualMinutes);
            if (finalReport) {
                builder.isScreenTimeGoalAchieved(clientAchieved)
                        .screenTimeFinalized(true);
            }
            dailyScreenTimeStatRepository.save(builder.build());
        }

        // 6. 목표 달성 알림(GROMO-395) — '최종 보고로 false→true 전이'일 때만 이벤트+알림을 1회 발사한다.
        //    interim 은 flag 를 true 로 세우지 않으므로 첫 마감은 항상 wasAchieved=false 를 보고 발사한다.
        //    마감 재시도(네이티브 읽기 미완료 시 앱이 재업로드)는 이미 true 인 flag 를 만나 재발사하지 않는다(날짜별 멱등).
        if (finalReport && clientAchieved && !wasAchieved) {
            // 재화 지급(GROMO-395)은 이 정산 트랜잭션 안에서 처리한다 — 아래 emitGoalAchievedAfterCommit 은
            // 롤백돼도 취소 불가한 알림/이벤트라 커밋 이후로 미루지만, 지급은 원장 정합을 위해 트랜잭션에 함께 묶는다.
            creditScreenTimeGoal(user, date);
            emitGoalAchievedAfterCommit(userId, date, actualMinutes);
        }
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 일별 스크린타임 upsert·지급처럼 users
     * 행은 <b>읽기만 하는</b> 변경 트랜잭션의 요청자 로드. 락 없는 findById 는 계정 탈퇴
     * (UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아 탈퇴의 정리 스캔 이후·커밋 이전에
     * 낀 저장이 유령(탈퇴자 명의 일 집계 행)으로 남는다. 공유 락끼리는 충돌하지 않아 동시 요청은
     * 그대로 병렬이고, 탈퇴가 먼저 커밋되면 READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404).
     *
     * <p><b>readOnly 트랜잭션에서는 쓰지 말 것</b> — Postgres 는 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 쓰기 트랜잭션({@code @Transactional})을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    /**
     * 스크린타임 목표 달성 지급(GROMO-395) — 목표 달성 false→true 전이 순간 1회. 사용 상한(분)이 빡셀수록
     * 큰 금액을 산정하고 멱등키 {@code stGoal:{userId}:{date}}(날짜별 1회) 로 정산 트랜잭션에 함께 기입한다.
     *
     * <p>상한은 <b>그날 유효했던 목표</b>({@link UserScreenTimeSettings#goalMinutesOn(LocalDate)})를 쓴다
     * (GROMO-1049) — 달성 판정은 클라(당시 목표)를 신뢰하는데 금액만 현재값으로 산정하면 목표를 바꾼 뒤
     * 앱이 보여준 금액과 실제 지급액이 어긋난다. 이력이 없는 유저는 현재값으로 근사한다. 상한 미설정(≤0)이면
     * 지급하지 않는다(공식은 0 을 최상위 구간으로 처리하므로 미설정 유저 과지급을 막기 위한 가드).
     */
    private void creditScreenTimeGoal(User user, LocalDate date) {
        // 위조 채굴 방어(코드리뷰) — 달성 판정은 클라 선언(achieved·isFinal·reportedAt)을 신뢰하므로,
        // 과거 날짜마다 선언을 심어 지급을 긁을 수 있다. 정상 지급 창을 오늘·어제로 한정한다(스크린타임 최종
        // 리포트는 익일 도착이라 어제까지 허용). 서버검증 측정 기반 완전 방어는 별도 후속.
        LocalDate today = LocalDate.now(ZonePolicy.KST);
        // 지급 창 = [어제, 오늘]. 오래된 과거뿐 아니라 미래 날짜(reportedAt 위조)도 거부한다 — 하한만 두면
        // 미래 날짜마다 달성을 선언해 채굴할 수 있다(코드리뷰 R3).
        if (date.isBefore(today.minusDays(1)) || date.isAfter(today)) {
            return;
        }
        int limitMinutes = userScreenTimeSettingsRepository.findById(user.getId())
                .map(s -> s.goalMinutesOn(date))
                .orElse(0);
        if (limitMinutes <= 0) {
            return;
        }
        int reward = CurrencyRewardPolicy.screenTimeGoalReward(limitMinutes);
        if (reward > 0) {
            currencyLedgerService.credit(user, CurrencyTransactionType.SCREEN_TIME_GOAL, reward,
                    "stGoal:" + user.getId() + ":" + date);
        }
    }

    /**
     * 목표 달성 이벤트·알림을 트랜잭션 커밋 이후로 미뤄 발사한다(GROMO-560 P2).
     *
     * <p>이벤트 로그(slf4j)·향후 APNs 푸시는 트랜잭션 side-effect 라 롤백돼도 취소되지 않는다. 동시 마감 레이스에서
     * 진 트랜잭션이 커밋 전 발사한 뒤 UNIQUE 위반으로 롤백하면 승자와 합쳐 중복 발사되므로, 커밋에 성공한
     * 트랜잭션에서만 {@code afterCommit} 으로 발사해 정확히 1회를 보장한다(진 트랜잭션은 롤백 → 미발사, 재시도는
     * wasAchieved=true 라 이 분기에 진입하지 않음). 트랜잭션 동기화가 비활성(단위 테스트 등)이면 즉시 발사한다.
     */
    private void emitGoalAchievedAfterCommit(UUID userId, LocalDate date, Integer actualMinutes) {
        Runnable emit = () -> {
            // actualMinutes 는 null(미집계)일 수 있다(GROMO-1267) — Map.of 는 null 값을 거부하므로
            // 미집계만 문자열 "null" 로 표기한다(집계된 값은 종전대로 숫자 유지).
            userActivityEventLogger.log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED, Map.of(
                    "date", date.toString(),
                    "actual_screen_time_minutes", actualMinutes != null ? actualMinutes : "null"));
            notificationPort.notify(userId, true);
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    emit.run();
                }
            });
        } else {
            emit.run();
        }
    }

    /**
     * reportedAt(Instant)을 KST 로컬 날짜로 환산한다 (GROMO-1259 — 저장축 KST 고정, {@link ZonePolicy}).
     * 판정·카드·정산이 전부 KST 라 저장 버킷도 같은 축이어야 한다(N8/FR-19). 해외 유저 어긋남은 L5 수용.
     */
    private LocalDate resolveLocalDate(ScreenTimeRequest request) {
        return request.getReportedAt().atZone(ZonePolicy.KST).toLocalDate();
    }
}
