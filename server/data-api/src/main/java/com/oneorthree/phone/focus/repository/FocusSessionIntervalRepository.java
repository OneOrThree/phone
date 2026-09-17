package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * v0.3 세션 구간 창구 (GROMO-1764). 세션 전체 구간을 한 번에 읽어(보통 세션당 몇 건뿐) 서비스가
 * 열린 구간 찾기·activeSeconds 합산·다음 ordinal 계산을 메모리에서 처리한다 — 매 판정마다
 * 별도 쿼리를 추가하지 않는다.
 */
public interface FocusSessionIntervalRepository extends JpaRepository<FocusSessionInterval, Long> {

    List<FocusSessionInterval> findBySessionIdOrderByOrdinalAsc(UUID sessionId);
}
