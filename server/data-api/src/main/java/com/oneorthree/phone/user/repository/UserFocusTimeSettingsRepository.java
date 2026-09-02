package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/**
 * 유저별 집중 시간 목표 설정. PK 가 곧 유저 id(1:1)라 기본 CRUD 만으로 충분해 추가 조회가 없다.
 * 설정을 만든 적 없는 유저는 <b>행 자체가 없으므로</b> 호출측이 기본값으로 폴백해야 한다.
 */
public interface UserFocusTimeSettingsRepository extends JpaRepository<UserFocusTimeSettings, UUID> {
}
