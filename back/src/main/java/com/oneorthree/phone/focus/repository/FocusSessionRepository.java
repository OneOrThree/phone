package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FocusSessionRepository extends JpaRepository<FocusSession, UUID> {

    // 기간 필터 + 커서(keyset) 페이지네이션. UUID v7 id 는 생성 시간순이라 id 내림차순이 곧 최신순.
    // cursor 가 null 이면 첫 페이지. Slice 는 size+1 조회로 hasNext 를 판정(count 쿼리 없음).
    // GROMO-872: 클라가 이 목록을 직접 합산(리그 '내 시간'·통계 타임라인)하므로 집계에서 빠져야 할 세션을 제외한다.
    // status NOT IN (CANCELED, AUTO_CLOSED) — 사용자 취소(CANCELED)와 orphan 자동 종료(AUTO_CLOSED)를 모두 배제.
    // 라이브 세션 배선(GROMO-873)에선 세션 1건이 라이브 레코드(종료 시 CANCELED·강제종료 시 AUTO_CLOSED)와
    // 완료 저장(POST /focus-session) 2줄로 남는데, 라이브 레코드의 두 종단 상태를 모두 걸러야 이중집계가 없다.
    // findCompletedSessionsOverlappingPeriod 등 다른 집계 쿼리와 동일한 NOT IN(CANCELED, AUTO_CLOSED) 관례.
    // ⚠️ ACTIVE(진행 중 라이브 레코드)는 여기서 제외하지 않아 목록에 남는다. 현재는 프론트 3개 소비처가
    //    endedAt(IS NULL) 을 Date.parse → NaN 비교로 방어적으로 걸러(합산 제외) 이중집계가 없다
    //    (focusRestore.ts:15, useLeagueRanking.ts:79, stats/format.ts). 다만 GROMO-873이 '라이브 행을 두고
    //    별도 완료 행을 POST' 하는 방식으로 구현되면 완료 전까지 ACTIVE 라이브 행과 COMPLETED 행이 공존하는
    //    구간이 생긴다 — 그때는 ACTIVE 제외 또는 완료 시 라이브 행 병합/삭제를 이 쿼리에서 재검토해야 한다.
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

    // currency 폐쇄(서버 지급): 완료 저장 재업로드 멱등 판정 — 같은 (user, startedAt, endedAt) 완료 세션 존재 여부.
    // 앱 업로드 대기열(pendingFocusUploads)이 응답 유실 시 동일 바디를 재전송하는데, 매 POST 가 새 행을 만들면
    // 세션 행 기반 멱등키(focus:{id}:reward)가 재생성돼 이중 지급이 된다 — insert 전에 이걸로 걸러 스킵한다.
    boolean existsByUserAndStartedAtAndEndedAtAndStatus(User user, Instant startedAt, Instant endedAt,
                                                        FocusSessionStatus status);

    // GROMO-1214 코드리뷰: 마커 id 기준 재업로드 멱등 판정 — 위 (startedAt, endedAt) 완전일치 검사는
    // 기기 시계가 서버와 어긋난 클라를 못 잡는다. 마커 경로는 서버가 시각을 클램프해 저장하므로, PATCH 가
    // 커밋된 뒤 응답만 유실돼 POST 로 폴백하면 저장값(클램프된 서버 시각)과 폴백 바디(기기 시각)가 달라
    // dedup 을 빠져나가 통계·코인이 두 번 들어간다. 폴백 바디에 실린 마커 id 로 '이미 완료된 마커'를 먼저 거른다.
    //
    // GROMO-1214 코드리뷰 3차 ③: 존재 조회가 아니라 **행 잠금 조회**다. 선점(claimMarkerIfActive)이 0 행이면
    // 그 마커는 이미 닫혔는데, 폐기(CANCELED/AUTO_CLOSED) 마커는 폴백이 새로 저장해야 하는 케이스다 —
    // 종전엔 잠금 없이 상태만 읽어 '검사~INSERT' 가 비원자적이었고, 타임아웃된 폴백과 큐 재시도가 겹치면
    // 둘 다 '완료 구간 없음'을 보고 각각 완료 행·통계·보상을 만들었다(유니크 제약 없음). 마커 행을 잠그면
    // 같은 마커를 든 폴백들이 직렬화돼 뒤선 쪽이 앞선 커밋을 구간 중복 검사에서 보게 된다.
    // user 조건은 남긴다 — 폴백 바디의 sessionId 는 클라 입력이라 남의 행을 잠그면 안 된다.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM FocusSession s WHERE s.id = :id AND s.user = :user")
    Optional<FocusSession> findByIdAndUserForUpdate(@Param("id") UUID id, @Param("user") User user);

    // 진행 중(미종료) 세션 — 핀 친구 isFocusing 판정용. endedAt IS NULL.
    List<FocusSession> findByUserInAndEndedAtIsNull(Collection<User> users);

    // 지금 집중 중(라이브) 세션 배치 조회 — userId 기반(FocusLiveInfoLookup 공용, GROMO-822).
    // 친구 목록 isFocusing·시작시각·태그명 도출용. User 기반 findByUserInAndEndedAtIsNull(핀 친구용)의 userId·태그 페치 확장판.
    // focusTag(user_focus_tags)와 그 defaultTag 를 LEFT JOIN FETCH 로 함께 로딩(태그명 매핑 N+1 방지 —
    // findCompletedSessionsOverlappingPeriod 관례).
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

    // 오늘(KST 하루) 완료된 실집중 세션 보유 유저 id — 재참여(GROMO-841)·순위 추월(GROMO-851)
    // '오늘 집중 여부' 판정용.
    // endedAt 이 [from,to) 에 든 세션만(취소·orphan 자동종료 제외). DailyFocusStat.date(country_code 로컬 버킷)와 달리
    // 절대시각 endedAt 윈도우라 타임존에 견고하고(비-KST 유저도 정확), 자정 넘겨 끝난 세션도 종료일 기준으로 포함된다.
    // (다른 집계 쿼리와 동일한 status 필터 관례. 단 윈도우는 '종료일 귀속'이 목적이라 endedAt 기준 그대로 두고,
    //  by-category(findCompletedSessionsOverlappingPeriod)처럼 겹침으로 바꾸지 않는다.)
    @Query("SELECT DISTINCT s.user.id FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.endedAt >= :from AND s.endedAt < :to "
            + "AND s.status NOT IN ("
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.AUTO_CLOSED)")
    List<UUID> findUserIdsWithCompletedFocusEndedBetween(@Param("userIds") Collection<UUID> userIds,
                                                         @Param("from") Instant from,
                                                         @Param("to") Instant to);

    // 지금 집중 중(라이브) 유저 id — 재참여/스트릭 위기(GROMO-841)·순위 추월(GROMO-851) 푸시에서
    // '현재 집중 중'을 대상에서 제외.
    // endedAt IS NULL 이면서 startedAt 이 liveSince 이후인 세션만 본다. startedAt 하한이 없으면 orphan 타임아웃
    // (FocusService.ORPHAN_TIMEOUT, 12h)을 넘겼는데 아직 스윕(GROMO-804) 안 된 미종료 세션(=버려진 세션, 실집중 0)까지
    // '라이브'로 잡혀, 정각 경합(스윕 지연) 시 알림을 과억제한다 → liveSince = now - 12h 로 최근 세션만 라이브로 인정.
    @Query("SELECT DISTINCT s.user.id FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.endedAt IS NULL AND s.startedAt >= :liveSince")
    List<UUID> findUserIdsWithLiveSession(@Param("userIds") Collection<UUID> userIds,
                                          @Param("liveSince") Instant liveSince);

    // 기간과 겹치는 완료 세션 집계용 전체 조회 — 카테고리별 집중 통계(GROMO-524).
    // GROMO-671(커밋3): local_date 컬럼 제거로 절대시각 윈도우 기준으로 조회한다.
    // GROMO-1252(코드리뷰 P1): endedAt-포함 윈도우 → **겹침(overlap) 윈도우**로 전환. 종전엔 endedAt 이 창 안인
    // 세션만 골라 세션 전체 길이를 더해, 자정을 걸친 세션이 종료일에 전량 귀속됐다(사전집계 DailyFocusStat 는
    // splitByLocalDay 로 날짜별로 쪼개는데 by-category 만 안 쪼개져 같은 화면의 총합과 과목별 합이 어긋났다).
    // GROMO-1214 코드리뷰 ⑥: 호출측(StatsService)은 클리핑한 겹침에서 방해 비율만큼 더 깎는다 —
    // daily_focus_stats.total_focus_seconds 가 순수 집중 시간이 됐으므로 같은 기준을 써야 총합과 맞는다
    // (sumOverlapSecondsInWindow 의 SQL 차감과 동일 공식).
    // 이제 창과 겹치는 세션을 모두 반환하고, 호출측(StatsService)이 세션 기여분을 창으로 클리핑해 더한다
    // (sumOverlapSecondsInWindow 의 LEAST/GREATEST 클리핑과 같은 결. 여기서 클리핑하지 않는 이유는
    //  태그별 그룹핑에 focusTag·defaultTag 페치가 필요해 엔티티를 그대로 넘기기 때문).
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
            + "AND s.endedAt > :from "
            + "AND s.startedAt < :to "
            + "AND s.status NOT IN ("
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "com.oneorthree.phone.focus.domain.FocusSessionStatus.AUTO_CLOSED)")
    List<FocusSession> findCompletedSessionsOverlappingPeriod(@Param("user") User user,
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

    // GROMO-1214 코드리뷰: endSessionIfActive 가 실패(row=0)했을 때 409 의 원인을 가르기 위한 상태 재조회.
    // 이미 로드한 엔티티(findById)는 UPDATE 이전 스냅샷이라, 그 사이 다른 트랜잭션이 CANCELED 로 바꿔도
    // ACTIVE 로 보인다 — 그리고 findById 재호출은 1차 캐시가 흡수해 DB 를 다시 읽지 않는다.
    // 엔티티가 아닌 스칼라(status) JPQL 은 캐시를 우회해 DB 값을 그대로 읽는다. 409 경로에서만 도는 추가 쿼리 1회.
    @Query("SELECT s.status FROM FocusSession s WHERE s.id = :id")
    Optional<FocusSessionStatus> findStatusById(@Param("id") UUID id);

    // 원자적 마커 선점(GROMO-1214 코드리뷰 2차) — POST 폴백이 '이 마커에 대해 완료 행을 만든다'를 claim 한다.
    // 위 existsByIdAndUserAndStatus 는 insert 전 **존재 조회**일 뿐이라, PATCH 가 타임아웃돼 앱이 곧바로 POST 로
    // 폴백하면 아직 커밋 전인 PATCH 를 못 보고(ACTIVE) 통과해 두 완료 행이 나란히 커밋됐다(통계·지급 이중 계상).
    // 조건부 UPDATE 는 마커 행 잠금으로 두 경로를 직렬화한다 — PATCH 가 진행 중이면 여기서 대기하다 커밋 후
    // ended_at IS NULL 재평가에 걸려 0 을 반환하고(→ 호출측이 COMPLETED 를 확인해 스킵), 반대로 이 UPDATE 가
    // 먼저 성사되면 뒤늦은 PATCH 가 0 행으로 409 를 받아 통계에 닿지 못한다.
    // cancelSessionIfActive 와 같은 결(취소로 마감)이지만 **user 조건이 붙는다** — 폴백 바디의 sessionId 는
    // 클라 입력이라, 소유 검사가 없으면 남의 진행 중 세션을 취소시킬 수 있다.
    @Modifying
    @Query("UPDATE FocusSession s "
            + "SET s.status = com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED, "
            + "s.endedAt = :canceledAt "
            + "WHERE s.id = :id AND s.user = :user AND s.endedAt IS NULL")
    int claimMarkerIfActive(@Param("id") UUID id, @Param("user") User user,
                            @Param("canceledAt") Instant canceledAt);

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

    /**
     * 창(TIME_WINDOW) 클리핑 집계 — [winStart, winEnd) 와 겹치는 완료 세션의 겹침 길이(초) 합을 유저별로 구한다.
     *
     * <p>세션을 창 경계로 클리핑(LEAST/GREATEST)해 겹친 구간만 계수한다. ACTIVE(미종료)는 ended_at IS NULL
     * 로, CANCELED·AUTO_CLOSED 는 status 로 제외 — findCompletedSessionsOverlappingPeriod 등 다른 집계 쿼리와 동일
     * 관례.
     *
     * <p><b>방해 초 차감(GROMO-1214 코드리뷰 ⑥)</b>: 겹침 길이를 그 세션의 방해 비율만큼 깎는다 —
     * {@code 기여분 = 겹침초 × (1 − total_distraction_seconds / (ended_at − started_at))}, 하한 0.
     * ⑤에서 {@code daily_focus_stats.total_focus_seconds} 가 순수 집중 시간이 되면서, 원시 겹침 길이를
     * 쓰던 이 창 집계는 일시정지가 낀 세션에서 일별 총합보다 커졌다. ⑤의 조각 비례 배분과 같은 규칙이라
     * 두 경로가 자연히 정합한다({@link com.oneorthree.phone.stats.service.StatsService} by-category 도 동일).
     * ⚠️ 이 값이 그룹 챌린지 달성 판정 → 내기 정산을 가른다 — 일시정지 시간으로 창을 통과하던 게 잘못이었다.
     *
     * <p><b>저장 분포를 안 쓰는 이유(GROMO-1214 코드리뷰 3차 ①)</b>: {@code focus_seconds_by_date} 는 날짜
     * 단위라 하루 안의 임의 시간창(TIME_WINDOW)에는 못 쓴다. 그래서 여기만 벽시계 gross 에서 비율 차감을
     * 유지한다 — 이 SQL 은 저장 분포를 읽지 않으므로 이중 차감이 아니다. 세션이 창에 통째로 들어오면
     * 결과는 {@code 구간 − 방해초} = 저장 분포의 합이라 사전집계와 총합이 일치한다(창이 세션을 자르는
     * 경우만 비례 근사 — 방해 초에 타임스탬프가 없어 불가피, 수용).
     *
     * <p>비율 계산은 SQL 에 둔다(유저별 GROUP BY 집계를 DB 에서 끝내는 기존 설계 유지 — 세션 행을 전부
     * 가져와 Java 에서 깎으면 그룹 인원×세션 수만큼 전송이 늘고, 이 집계는 카드 진행률·정산·창 종료
     * 알림에서 반복 호출된다). {@code EXTRACT(EPOCH ...)} 가 numeric 이라 나눗셈이 정수 절삭되지 않고,
     * 0초 세션은 {@code NULLIF}→{@code COALESCE} 로 비율 0 이 된다. 최종 {@code bigint} 캐스트에서만 반올림.
     * LEAST/GREATEST + EXTRACT(EPOCH) 조합은 JPQL 로 표현할 수 없어 네이티브로 둔다
     * (그룹 챌린지 WindowFocusAggregator 전용).
     */
    @Query(value = "SELECT s.user_id AS \"userId\", "
            + "CAST(SUM(GREATEST(0, "
            + "EXTRACT(EPOCH FROM (LEAST(s.ended_at, :winEnd) - GREATEST(s.started_at, :winStart))) "
            + "* (1 - COALESCE(s.total_distraction_seconds "
            + "/ NULLIF(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)), 0), 0)))) "
            + "AS bigint) AS \"overlapSeconds\" "
            + "FROM focus_sessions s "
            + "WHERE s.user_id IN (:userIds) "
            + "AND s.status NOT IN ('CANCELED', 'AUTO_CLOSED') "
            + "AND s.ended_at IS NOT NULL "
            + "AND s.ended_at > :winStart AND s.started_at < :winEnd "
            + "GROUP BY s.user_id", nativeQuery = true)
    List<WindowFocusOverlap> sumOverlapSecondsInWindow(@Param("userIds") Collection<UUID> userIds,
                                                       @Param("winStart") Instant winStart,
                                                       @Param("winEnd") Instant winEnd);

    /** {@link #sumOverlapSecondsInWindow} 네이티브 프로젝션 — 유저별 창 겹침 초. */
    interface WindowFocusOverlap {
        UUID getUserId();

        long getOverlapSeconds();
    }

    // 태그 rename 세션 재연결(GROMO-754) — 옛(소프트삭제) 태그를 참조하던 세션 전부를 새로 채택한 태그로 재지정한다.
    // rename = 옛 UserFocusTag softDelete + 새 이름 재채택(GROMO-673)이라, 재연결 없으면 과거 세션이 소프트삭제 태그를
    // 계속 참조해 by-category 통계에서 '미분류'로 강등된다. 날짜 조건 없이 전체기간을 옮긴다(총량 불변, 귀속만 이동).
    // 반환값은 재지정된 세션 수(대상 0건이면 0 — 실패 아님).
    @Modifying
    @Query("UPDATE FocusSession s SET s.focusTag = :newTag WHERE s.focusTag = :oldTag")
    int repointFocusTag(@Param("oldTag") UserFocusTag oldTag, @Param("newTag") UserFocusTag newTag);
}
