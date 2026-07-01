package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserFocusTimeSettingsRepository extends JpaRepository<UserFocusTimeSettings, UUID> {
}
