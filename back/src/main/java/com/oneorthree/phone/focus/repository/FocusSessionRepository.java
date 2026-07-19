package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface FocusSessionRepository extends JpaRepository<FocusSession, UUID> {

    // 기간 필터 + 커서(keyset) 페이지네이션. UUID v7 id 는 생성 시간순이라 id 내림차순이 곧 최신순.
    // cursor 가 null 이면 첫 페이지. Slice 는 size+1 조회로 hasNext 를 판정(count 쿼리 없음).
    // GROMO-872: 클라가 이 목록을 직접 합산(리그 '내 시간'·통계 타임라인)하므로 집계에서 빠져야 할 세션을 제외한다.
    // status NOT IN (CANCELED, AUTO_CLOSED) — 사용자 취소(CANCELED)와 orphan 자동 종료(AUTO_CLOSED)를 모두 배제.
    // 라이브 세션 배선(GROMO-873)에선 세션 1건이 라이브 레코드(종료 시 CANCELED·강제종료 시 AUTO_CLOSED)와
    // 완료 저장(POST /focus-session) 2줄로 남는데, 라이브 레코드의 두 종단 상태를 모두 걸러야 이중집계가 없다.
    // findCompletedSessionsInPeriod 등 다른 집계 쿼리와 동일한 NOT IN(CANCELED, AUTO_CLOSED) 관례.
    @Query("SELECT s FROM FocusSession s "
            + "WHERE s.user = :user AND s.startedAt BETWEEN :from AND :to "
            + "AND s.status NOT IN ("
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.AUTO_CLOSED) "
            + "AND (:cursor IS NULL OR s.id < :cursor) "
            + "ORDER BY s.id DESC")
    Slice<FocusSession> findSessionsByCursor(@Param("user") User user,
                                             @Param("from") Instant from,
                                             @Param("to") Instant to,
                                             @Param("cursor") UUID cursor,
                                             Pageable pageable);

    // 진행 중(미종료) 세션 — 핀 친구 isFocusing 판정용. endedAt IS NULL.
    List<FocusSession> findByUserInAndEndedAtIsNull(Collection<User> users);

    // 지금 집중 중(라이브) 세션 배치 조회 — userId 기반(FocusLiveInfoLookup 공용, GROMO-822).
    // 친구 목록 isFocusing·시작시각·태그명 도출용. User 기반 findByUserInAndEndedAtIsNull(핀 친구용)의 userId·태그 페치 확장판.
    // focusTag(user_focus_tags)와 그 defaultTag 를 LEFT JOIN FETCH 로 함께 로딩(태그명 매핑 N+1 방지 —
    // findCompletedSessionsInPeriod 관례).
    // startedAt >= liveSince: 미종료여도 orphan 타임아웃(12h)을 넘겼는데 아직 스윕(GROMO-804) 안 된 버려진 세션은
    // '라이브'에서 제외한다(findUserIdsWithLiveSession, GROMO-841 과 동일 기준). 이 응답이 focusStartedAt 을 노출하므로
    // 하한이 없으면 12시간 전 시작한 죽은 세션이 '집중 중'으로 보인다.
    // ORDER BY startedAt DESC: 단일 라이브 세션을 강제하는 가드가 없어(중복 시작 가능) 한 유저에 미종료 세션이 여럿일 때,
    // 호출측이 최신 세션을 결정적으로 고르게 한다(정렬 없으면 startedAt·태그명이 호출마다 뒤집힐 수 있음).
    @Query("SELECT s FROM FocusSession s "
            + "LEFT JOIN FETCH s.focusTag ft "
            + "LEFT JOIN FETCH ft.defaultTag "
            + "WHERE s.user.id IN :userIds AND s.endedAt IS NULL AND s.startedAt >= :liveSince "
            + "ORDER BY s.startedAt DESC")
    List<FocusSession> findLiveSessionsByUserIdIn(@Param("userIds") Collection<UUID> userIds,
                                                  @Param("liveSince") Instant liveSince);

    // orphan 정리용(GROMO-610) — 앱 강제종료 등으로 threshold 이전에 시작됐으나 아직 미종료인 세션.
    // 스케줄러가 조회해 시작+상한으로 종료시각을 채워 '영원히 집중중' 오염을 제거한다.
    List<FocusSession> findByEndedAtIsNullAndStartedAtBefore(Instant threshold);

    // 오늘 집중 여부 판정용(GROMO-579 순위 추월 억제조건 c) — 대상 유저들 중 오늘(KST 하루 구간)
    // 시작한 세션이 하나라도 있는 유저 id 집합을 반환. startedAt 기준(라이브·소프트딜리트 무관 — '오늘 집중 행동을 했나'만 판단).
    // 유저별 단건 조회 N+1 금지: 대상 유저 전체를 한 쿼리로 좁혀 in-memory 판정.
    @Query("SELECT DISTINCT s.user.id FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.startedAt >= :from AND s.startedAt < :to")
    List<UUID> findUserIdsWithSessionStartedBetween(@Param("userIds") Collection<UUID> userIds,
                                                    @Param("from") Instant from,
                                                    @Param("to") Instant to);

    // 오늘(KST 하루) 완료된 실집중 세션 보유 유저 id — 재참여 '오늘 집중 여부' 판정용(GROMO-841).
    // endedAt 이 [from,to) 에 든 세션만(취소·orphan 자동종료 제외). DailyFocusStat.date(country_code 로컬 버킷)와 달리
    // 절대시각 endedAt 윈도우라 타임존에 견고하고(비-KST 유저도 정확), 자정 넘겨 끝난 세션도 종료일 기준으로 포함된다.
    // (findCompletedSessionsInPeriod 와 동일한 endedAt-윈도우 + status 필터 관례.)
    @Query("SELECT DISTINCT s.user.id FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.endedAt >= :from AND s.endedAt < :to "
            + "AND s.status NOT IN ("
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.AUTO_CLOSED)")
    List<UUID> findUserIdsWithCompletedFocusEndedBetween(@Param("userIds") Collection<UUID> userIds,
                                                         @Param("from") Instant from,
                                                         @Param("to") Instant to);

    // 지금 집중 중(라이브) 유저 id — 재참여/스트릭 위기 푸시에서 '현재 집중 중'을 대상에서 제외(GROMO-841).
    // endedAt IS NULL 이면서 startedAt 이 liveSince 이후인 세션만 본다. startedAt 하한이 없으면 orphan 타임아웃
    // (FocusService.ORPHAN_TIMEOUT, 12h)을 넘겼는데 아직 스윕(GROMO-804) 안 된 미종료 세션(=버려진 세션, 실집중 0)까지
    // '라이브'로 잡혀, 정각 경합(스윕 지연) 시 알림을 과억제한다 → liveSince = now - 12h 로 최근 세션만 라이브로 인정.
    @Query("SELECT DISTINCT s.user.id FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.endedAt IS NULL AND s.startedAt >= :liveSince")
    List<UUID> findUserIdsWithLiveSession(@Param("userIds") Collection<UUID> userIds,
                                          @Param("liveSince") Instant liveSince);

    // 기간 내 완료 세션 집계용 전체 조회 — 카테고리별 집중 통계(GROMO-524).
    // GROMO-671(커밋3): local_date 컬럼 제거로 endedAt(UTC) [from,to) 윈도우 기준으로 조회한다.
    // 취소(CANCELED) 세션은 제외(과거 deleted_at IS NULL 을 status 기반으로 전환).
    // GROMO-804: orphan 자동 종료(AUTO_CLOSED) 세션도 제외한다. orphan 은 endedAt 이 채워져 이 윈도우에 걸리지만
    // 통계 미반영 세션이므로, 여기서 걸러야 사전집계 /stats/focus 와 by-category 총합이 일치한다.
    // GROMO-733: 정상 완료가 이제 status=COMPLETED 지만, 필터는 여전히 NOT IN(CANCELED, AUTO_CLOSED)를 쓴다 —
    // COMPLETED 는 NOT IN 을 통과해 포함되고, 레거시 완료(endedAt 채워진 채 ACTIVE 로 남은 세션)도 함께 포함해야
    // 하기 때문(status=COMPLETED 단독 필터로 바꾸면 레거시 완료가 누락된다). 제외 대상만 명시하는 방식이 정답이다.
    // GROMO-673: focusTag(user_focus_tags)와 그 defaultTag 까지 LEFT JOIN FETCH 로 N+1(이름 매핑) 방지.
    @Query("SELECT s FROM FocusSession s "
            + "LEFT JOIN FETCH s.focusTag ft "
            + "LEFT JOIN FETCH ft.defaultTag "
            + "WHERE s.user = :user "
            + "AND s.endedAt IS NOT NULL "
            + "AND s.endedAt >= :from "
            + "AND s.endedAt < :to "
            + "AND s.status NOT IN ("
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.AUTO_CLOSED)")
    List<FocusSession> findCompletedSessionsInPeriod(@Param("user") User user,
                                                     @Param("from") Instant from,
                                                     @Param("to") Instant to);

    @Modifying
    @Query("UPDATE FocusSession f SET f.user = null WHERE f.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);

    // 원자적 조건부 종료(GROMO-610) — 진행 중(endedAt IS NULL)인 경우에만 종료 시각을 채운다.
    // 반환값(영향 row 수)이 1이면 이 요청이 종료를 성사시킨 것이고, 0이면 이미 종료됨(동시/중복 PATCH).
    // DB 단일 UPDATE 로 read-modify-write 를 원자화해 endFocusSession 의 TOCTOU 이중 완료(통계 이중 누적)를 차단한다.
    @Modifying
    @Query("UPDATE FocusSession s SET s.endedAt = :endedAt "
            + "WHERE s.id = :id AND s.endedAt IS NULL")
    int endSessionIfActive(@Param("id") UUID id, @Param("endedAt") Instant endedAt);

    // 원자적 조건부 orphan 자동 종료(GROMO-804) — 아직 미종료(endedAt IS NULL)인 경우에만 AUTO_CLOSED 로 마감한다.
    // 반환값(영향 row 수)이 1이면 이 스윕이 종료를 성사시킨 것이고, 0이면 그 사이 유저 PATCH(endSessionIfActive)가
    // 먼저 완료해 이미 통계에 반영된 세션이다. 엔티티 autoClose() 더티 라이트는 이 경합에서 완료된 세션의 endedAt·status 를
    // 무조건 덮어써(통계엔 이미 계수됨) by-category 에서 사라지게 만드므로, DB 단일 UPDATE 로 조건을 원자화해 차단한다.
    @Modifying
    @Query("UPDATE FocusSession s "
            + "SET s.status = com.oneorthree.phone.focus.domain.FocusSessionStatus.AUTO_CLOSED, "
            + "s.endedAt = :endedAt "
            + "WHERE s.id = :id AND s.endedAt IS NULL")
    int markAutoClosedIfOpen(@Param("id") UUID id, @Param("endedAt") Instant endedAt);

    // 원자적 조건부 유저 취소(GROMO-733) — 진행 중(endedAt IS NULL)인 경우에만 CANCELED 로 마감하고 취소 시각을 채운다.
    // 반환값(영향 row 수)이 1이면 이 요청이 취소를 성사시킨 것이고, 0이면 이미 종료/취소된 세션(멱등 — 재취소·이중 취소 차단).
    // endSessionIfActive 미러 구조지만, 취소는 markAutoClosedIfOpen 처럼 status 를 벌크 UPDATE 에서 직접 세팅한다
    // (완료(COMPLETED)는 관리 엔티티 end() 더티 flush 로 반영하는 것과 달리, 취소는 통계 귀속이 없어 벌크 단일 세팅으로 충분).
    @Modifying
    @Query("UPDATE FocusSession s "
            + "SET s.status = com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "s.endedAt = :canceledAt "
            + "WHERE s.id = :id AND s.endedAt IS NULL")
    int cancelSessionIfActive(@Param("id") UUID id, @Param("canceledAt") Instant canceledAt);

    // 태그 rename 세션 재연결(GROMO-754) — 옛(소프트삭제) 태그를 참조하던 세션 전부를 새로 채택한 태그로 재지정한다.
    // rename = 옛 UserFocusTag softDelete + 새 이름 재채택(GROMO-673)이라, 재연결 없으면 과거 세션이 소프트삭제 태그를
    // 계속 참조해 by-category 통계에서 '미분류'로 강등된다. 날짜 조건 없이 전체기간을 옮긴다(총량 불변, 귀속만 이동).
    // 반환값은 재지정된 세션 수(대상 0건이면 0 — 실패 아님).
    @Modifying
    @Query("UPDATE FocusSession s SET s.focusTag = :newTag WHERE s.focusTag = :oldTag")
    int repointFocusTag(@Param("oldTag") UserFocusTag oldTag, @Param("newTag") UserFocusTag newTag);
}
