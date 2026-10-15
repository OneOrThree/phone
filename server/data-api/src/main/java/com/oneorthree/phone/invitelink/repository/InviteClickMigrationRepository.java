package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteClickMigration;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 클릭 이관 회차 저장소 (서비스 §7.2).
 */
public interface InviteClickMigrationRepository extends JpaRepository<InviteClickMigration, String> {
}
