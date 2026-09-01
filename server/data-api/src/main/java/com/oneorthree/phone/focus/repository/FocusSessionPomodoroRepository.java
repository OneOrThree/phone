package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionPomodoro;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * 뽀모도로 세션의 회차·휴식 상세({@code focus_session_pomodoro}) — 집중 세션 1건당 최대 1행.
 */
public interface FocusSessionPomodoroRepository extends JpaRepository<FocusSessionPomodoro, UUID> {

    /**
     * 세션 1:1 상세 조회 — 포모도로 세션 플로 배선은 별도 기능 티켓
     *
     * @param focusSession 상세를 찾을 집중 세션
     * @return 뽀모도로 상세. INFINITE·RANGE 세션이거나 아직 상세를 안 남긴 세션이면 빈 값
     */
    Optional<FocusSessionPomodoro> findByFocusSession(FocusSession focusSession);
}
