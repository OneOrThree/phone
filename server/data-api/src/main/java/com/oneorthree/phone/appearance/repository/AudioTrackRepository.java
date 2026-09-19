package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.AudioTrack;
import org.springframework.data.jpa.repository.JpaRepository;

/** 음원 길이 조회 — 불변 행이라 잠그지 않는다. writer 는 카탈로그 등록(상점 운영)이다. */
public interface AudioTrackRepository extends JpaRepository<AudioTrack, String> {
}
