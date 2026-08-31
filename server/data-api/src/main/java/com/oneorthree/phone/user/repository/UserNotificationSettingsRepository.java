package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserNotificationSettingsRepository extends JpaRepository<UserNotificationSettings, UUID> {
}
