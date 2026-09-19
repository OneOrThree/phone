package com.oneorthree.phone.screentime.repository;

import com.oneorthree.phone.screentime.repository.domain.ScreenTimeObservation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 기기별 스크린타임 관측 창구 (GROMO-1769). 모든 조회는 사용자 축이다 — 전역 deviceId 조회가 없다(LLD §4). */
public interface ScreenTimeObservationRepository extends JpaRepository<ScreenTimeObservation, Long> {

    Optional<ScreenTimeObservation> findByUserIdAndDeviceIdAndMeasuredDateAndMeasuredAt(
            UUID userId, UUID deviceId, LocalDate measuredDate, Instant measuredAt);

    /** 이 기기·날짜의 최신 선택 관측. */
    Optional<ScreenTimeObservation> findFirstByUserIdAndDeviceIdAndMeasuredDateOrderByMeasuredAtDesc(
            UUID userId, UUID deviceId, LocalDate measuredDate);

    /** 조회 기간의 관측 전부 — 서비스가 (사용자, 날짜, 기기) 별 최신을 고른다. */
    List<ScreenTimeObservation> findByUserIdInAndMeasuredDateBetween(Collection<UUID> userIds, LocalDate from,
                                                                     LocalDate to);

    /** 탈퇴 — 개인 측정 원본이라 익명화하지 않고 지운다(계정 LLD §4, 다른 사람의 판정 근거가 아니다). */
    @Modifying
    @Query("DELETE FROM ScreenTimeObservation o WHERE o.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
