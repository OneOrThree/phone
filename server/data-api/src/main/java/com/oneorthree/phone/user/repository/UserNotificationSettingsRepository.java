package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/**
 * 유저별 알림 수신 설정. PK 가 곧 유저 id(1:1)다. 행이 없으면 아직 한 번도 설정을 저장하지 않은
 * 유저이므로, 수신 여부 판정은 그 경우의 기본값을 호출측이 정한다.
 */
public interface UserNotificationSettingsRepository extends JpaRepository<UserNotificationSettings, UUID> {
}
