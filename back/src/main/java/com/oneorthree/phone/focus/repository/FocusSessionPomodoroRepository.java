package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionPomodoro;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface FocusSessionPomodoroRepository extends JpaRepository<FocusSessionPomodoro, UUID> {

    /**
     * 세션 1:1 상세 조회 — 포모도로 세션 플로 배선은 별도 기능 티켓
     */
    Optional<FocusSessionPomodoro> findByFocusSession(FocusSession focusSession);
}
