package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.PomodoroSetting;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface PomodoroSettingRepository extends JpaRepository<PomodoroSetting, UUID> {

    // 활성 프리셋 목록 (소프트 딜리트 제외) — 프리셋 조회 API 는 별도 기능 티켓에서 배선
    List<PomodoroSetting> findByDeletedAtIsNull();
}
