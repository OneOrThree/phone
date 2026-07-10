package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.DefaultTag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface DefaultTagRepository extends JpaRepository<DefaultTag, UUID> {

    // name 전역 유일 — 커스텀 태그 생성 시 기존 마스터 재사용(중복 제거) 조회에 사용.
    Optional<DefaultTag> findByName(String name);
}
