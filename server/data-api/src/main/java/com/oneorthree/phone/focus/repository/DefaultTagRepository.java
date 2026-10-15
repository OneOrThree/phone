package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * 태그 이름의 전역 마스터({@code default_tags}). 유저가 채택한 태그({@code user_focus_tags})는 이 마스터를
 * 참조하므로, 같은 이름은 유저가 몇 명이든 마스터 1행을 공유한다.
 */
public interface DefaultTagRepository extends JpaRepository<DefaultTag, UUID> {

    /**
     * name 전역 유일 — 커스텀 태그 생성 시 기존 마스터 재사용(중복 제거) 조회에 사용.
     *
     * @param name 유저가 입력한 태그 이름. 정규화 없이 그대로 비교하므로 공백·대소문자가 다르면 다른 마스터가 된다
     * @return 같은 이름의 마스터. 없으면 빈 값이고, 호출측이 새 마스터를 만든다
     */
    Optional<DefaultTag> findByName(String name);
}
