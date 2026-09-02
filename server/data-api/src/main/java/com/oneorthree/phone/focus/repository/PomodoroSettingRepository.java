package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.PomodoroSetting;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * 뽀모도로 프리셋(집중/휴식 길이 조합) 마스터. 소프트 딜리트라 폐기된 프리셋도 행은 남는다 —
 * 과거 세션이 참조하고 있기 때문이다.
 */
public interface PomodoroSettingRepository extends JpaRepository<PomodoroSetting, UUID> {

    /**
     * 활성 프리셋 목록 (소프트 딜리트 제외) — 프리셋 조회 API 는 별도 기능 티켓에서 배선
     *
     * @return 아직 폐기되지 않은 프리셋. 정렬을 지정하지 않아 순서는 보장되지 않는다
     */
    List<PomodoroSetting> findByDeletedAtIsNull();
}
