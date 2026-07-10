package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupJoinCode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface GroupJoinCodeRepository extends JpaRepository<GroupJoinCode, UUID> {

    Optional<GroupJoinCode> findByCode(String code);

    boolean existsByCode(String code);
}
