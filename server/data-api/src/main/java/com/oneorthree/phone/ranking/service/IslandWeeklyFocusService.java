package com.oneorthree.phone.ranking.service;

import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.ranking.repository.IslandWeeklyFocusRepository;
import com.oneorthree.phone.ranking.support.RankingWeek;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * 주간 섬 랭킹 분자의 read model 갱신 (GROMO-2343, V130).
 *
 * <p>정본은 여전히 {@code focus_session_details}·{@code focus_session_intervals} 다. 이 서비스는 그 정본을
 * 주 창({@link RankingWeek})으로 접은 사본을 두 길로 맞춘다 — 완료 전이마다 «그 세션의 몫»을 더하는
 * {@link #addCompleted}(즉시 반영), 그리고 정본으로 한 주를 통째로 다시 채우는 {@link #recompute}(장애·백필).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IslandWeeklyFocusService {

    private final IslandWeeklyFocusRepository weeklyFocus;
    private final Clock clock;
    private final PlatformTransactionManager transactionManager;

    /**
     * 섬 세션 하나가 COMPLETED 로 끝났다 — 그 ACTIVE 구간을 주마다 잘라 그 섬의 주 합에 더한다.
     *
     * <p>호출자(완료 전이)의 트랜잭션에서만 부른다 — 정산이 롤백되면 가산도 함께 사라져야 한다. 한 세션이 두 번
     * 더해지지 않는 것은 정산 행({@code focus_settlements}, PK = session_id)이 지킨다: 두 번째 완료는 그 INSERT 에서
     * 실패해 이 가산까지 롤백된다.
     *
     * @param islandId  세션이 시작할 때 고정한 섬
     * @param intervals 그 세션의 전체 구간 — 전부 닫힌 뒤다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void addCompleted(UUID islandId, List<FocusSessionInterval> intervals) {
        Instant now = clock.instant();
        activeMicrosByWeek(intervals).forEach((week, micros) -> weeklyFocus.add(week, islandId, micros, now));
    }

    /**
     * 그 주를 정본으로 다시 채운다 — 주 마감 크론이 방금 끝난 주를 맞추고, 장애 뒤 수동 백필도 이것이다.
     * 다시 돌려도 같은 값이다.
     *
     * <p><b>호출자는 트랜잭션 밖에서 불러야 한다</b> — 이 메서드가 자기 트랜잭션을 열고 커밋해 테이블 잠금을 바로 푼다.
     * 바깥 트랜잭션에 합류하면 잠금이 그 끝까지 늘어나, 뒤이은 쓰기가 {@code groups} FK 검사(KEY SHARE)를 하는 순간
     * 집중 완료(groups FOR UPDATE → 테이블 잠금)와 순서가 뒤집혀 교착한다. 그래서 활성 트랜잭션 안에서 부르면 거절한다.
     *
     * @return 채운 섬 수
     * @throws IllegalStateException 트랜잭션 안에서 불렀을 때
     */
    public int recompute(LocalDate week) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("recompute 는 트랜잭션 밖에서 부른다 — 테이블 잠금이 바깥 트랜잭션 끝까지 남는다");
        }
        Integer filled = new TransactionTemplate(transactionManager).execute(status -> {
            weeklyFocus.lockForRecompute();
            weeklyFocus.clear(week);
            return weeklyFocus.fill(week, RankingWeek.startInstant(week), RankingWeek.endInstant(week),
                    clock.instant());
        });
        log.info("주간 섬 랭킹 분자 재계산 week={} 섬={}", week, filled);
        return filled == null ? 0 : filled;
    }

    /**
     * ACTIVE 구간을 주 경계에서 잘라 주마다 μs 를 모은다. 초로 내리지 않는다 — 내림은 읽는 쪽이 섬마다 한 번만 한다.
     * 열린 구간은 건너뛴다(끝난 집중만 반영).
     */
    static Map<LocalDate, Long> activeMicrosByWeek(List<FocusSessionInterval> intervals) {
        Map<LocalDate, Long> byWeek = new TreeMap<>();
        for (FocusSessionInterval interval : intervals) {
            Instant end = interval.getEndedAt();
            if (interval.getKind() != FocusIntervalKind.ACTIVE || end == null) {
                continue;
            }
            Instant cursor = interval.getStartedAt();
            while (cursor.isBefore(end)) {
                LocalDate week = RankingWeek.weekStart(cursor);
                Instant weekEnd = RankingWeek.endInstant(week);
                Instant pieceEnd = end.isBefore(weekEnd) ? end : weekEnd;
                byWeek.merge(week, Duration.between(cursor, pieceEnd).toNanos() / 1000L, Long::sum);
                cursor = pieceEnd;
            }
        }
        return byWeek;
    }
}
