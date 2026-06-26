package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserScreenTimeSettingsRepository extends JpaRepository<UserScreenTimeSettings, UUID> {
}
