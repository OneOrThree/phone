package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.ranking.repository.IslandFocusAverageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 섬별 «최근 7일 주민 1명당 하루 평균 집중(분)» 일 스냅샷 배치 로직 (GROMO-2257, 섬 외부 계약 §3).
 *
 * <p>스케줄 트리거({@code IslandFocusAverageScheduler})와 분리돼 있다 — 테스트는 크론 없이 이것만 부른다
 * ({@code IslandRankingFreezeService} 와 같은 구성). 트랜잭션 경계도 여기다: {@code @Scheduled} 는 스스로
 * 트랜잭션이 없고 리포지토리는 경계를 소유하지 않는다(규약 §4·§5).
 *
 * <p>집중 합(focus 2)·주민 수(group 5)·저장 표(ranking 4)를 «조합»하므로 L10 internal 에 둔다
 * ({@code IslandRankingsService} 와 같은 이유 — 이 조합을 {@code ranking} 에 넣으면 그 도메인이 group 위로
 * 올라간다).
 *
 * <h2>값의 정의</h2>
 * 창은 {@code [D-7 07:00 KST, D 07:00 KST)}, 분자는 그 창 안의 섬 집중 초 합
 * ({@link FocusSessionDetailRepository#sumIslandActiveSeconds} — <b>끝난(COMPLETED) 세션의 ACTIVE 구간만</b>,
 * 휴식·진행 중 세션은 빠진다), 분모는 <b>지금</b>의 주민 수({@link GroupMemberRepository#countByGroupIdIn})와
 * 7일이다. 값은 {@code round(초 ÷ 60 ÷ 주민 수 ÷ 7)} 이다. 주간 섬 랭킹({@code IslandRankingsService})은 초 단위·
 * 고정 분모라 <b>값이 다르다</b> — 계약이 수용한 차이다.
 *
 * <p>값은 «그 순간의 정확한 평균» 이 아니라 표시용 근사다. 받아들인 치우침 셋:
 * <ul>
 *   <li>07시에 아직 진행 중인 세션은 그날 행에서 통째로 빠진다 — 끝난 다음 날 행에서 센다.</li>
 *   <li>분자는 «세션이 시작할 때 고정한 섬», 분모는 «지금의 주민 수» 라 막 커진 섬은 낮게, 막 줄어든 섬은 높게 읽힌다.</li>
 *   <li>막 생긴 섬은 다음 07시까지 행이 없다 — reader 는 empty 를 주고 호출자가 null 로 낸다.</li>
 * </ul>
 *
 * <p><b>모집단은 살아 있는 섬 «전부»</b>({@link GroupRepository#findAliveIslandIds})다 — 비공개 섬도 해 될 것이
 * 없어 같이 계산한다. 세션이나 멤버십에서 출발하면 집중이 0인 섬과 주민이 0명인 섬이 행에서 빠진다. 주민이
 * 0명이면 평균은 <b>null</b>(분모 0), 주민이 있고 집중이 없으면 <b>0</b> 이다.
 *
 * <p>그 목록은 읽은 뒤 낡을 수 있다 — 마지막 주민의 이탈·계정 탈퇴가 그사이 섬을 닫고 공동 데이터를 지울 수 있다.
 * 지운 뒤에 행이 적히면 닫힌 섬의 행이 영영 남는다(묘비 섬은 FK CASCADE 가 안 돌고 다음 배치는 죽은 섬을 건너뛴다).
 * 그래서 적는 문장({@link IslandFocusAverageRepository#insertIfAbsent})이 섬 행을 {@code FOR SHARE} 로 잠그며
 * 살아 있는지를 <b>다시</b> 확인한다 — 그사이 죽은 섬은 행이 적히지 않고 반환값에도 세지 않는다.
 *
 * <p>07시에 인스턴스가 모두 죽어 있으면 그날 행이 없다 — 읽는 쪽이 «가장 최근 행» 을 주므로 하루 묵은 값이 나간다.
 * 자동 보정 잡은 두지 않고, 운영자가 내부 관리 API({@code POST /internal/admin/island-focus-averages/snapshots},
 * GROMO-2280)로 {@link #lastClosedDate()} 까지의 날짜를 손으로 적는다 — 배포 직후 오늘 행을 만들 때도 같은 경로다.
 * 행은 섬 × 일 1건씩 쌓이고, 크론이 스냅샷 뒤 {@link #cleanup} 으로 보존 일수(기본 90일)보다 오래된 행을 지운다(섬마다
 * 최신 1행은 남긴다). {@code countByGroupIdIn} 은 섬 id 를
 * {@link #ID_CHUNK}(5000)개씩 끊어 부르므로 살아 있는 섬이 3만을 넘어도 바인드 파라미터 상한(32767)에 걸리지 않는다.
 *
 * <p>ponytail: 적는 문장은 살아 있는 섬의 행을 한 문장에서 id 오름차순으로 {@code FOR SHARE} 잠근다. 섬 행을
 * 잠그는 쪽(가입·이탈·삭제)이 여러 섬을 <b>다른 순서</b>로 잠그면 07시에 겹칠 때 교착할 수 있다 — 계정 탈퇴의
 * {@code GroupMembershipMutationLocks#lockGroups} 는 Java {@code UUID} 순서, 여기는 PostgreSQL uuid 순서라 최상위
 * 비트가 선 옛 id 에서 순서가 갈린다. PostgreSQL 이 한쪽을 끊고 끊긴 쪽이 배치면 스케줄러가 한 번 다시 돌린다 — 적는
 * 문장이 하나뿐이라 롤백으로 아무것도 남지 않고 {@code ON CONFLICT} 라 다시 돌려도 안전하다. 재시도도 끊기면 error 로그만
 * 남고 그날 행이 통째로 없다 — 읽는 쪽은 전날 행을 준다. 잦아지면 재시도 횟수·간격을 늘린다.
 *
 * <p>ponytail: 주민 수({@code countByGroupIdIn})와 집중 합({@code sumIslandActiveSeconds})은 READ COMMITTED 문장
 * 둘이라, 그 사이에 이탈·세션 완료가 겹치면 한 순간에 없던 (분자, 분모) 짝이 그날 값으로 고정된다 —
 * {@code ON CONFLICT DO NOTHING} 이라 그날은 다시 쓰이지 않는다(두 집계 사이 = 집중 합 집계 소요 시간만큼의 창,
 * 표시용 값, 다음 날 재계산으로 풀린다). 문제가 되면 두 집계를 REPEATABLE READ 읽기 전용 트랜잭션 하나로 읽고
 * INSERT 는 지금처럼 별도 트랜잭션에서 한다. 잠금을 먼저 잡는 방식은 07시에 모든 섬의 집중 전이·멤버십 변경을
 * 막으므로 쓰지 않는다. 같은 기준으로 적는 문장의 {@code alive} {@code FOR SHARE} 가 살아 있는 섬 전부의 행을 그 한
 * 문장 동안 쥐는 것은 받아들인다(집계 시간은 빠진 짧은 구간).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IslandFocusAverageSnapshotService {

    /** 배치가 도는 KST 시각(시). 창 경계가 이 시각이다 — 크론({@code IslandFocusAverageScheduler})과 같은 값. */
    private static final int SNAPSHOT_HOUR_KST = 7;
    /** 평균을 내는 창의 길이(일) — 분모의 「÷ 7」 이기도 하다. */
    private static final int WINDOW_DAYS = 7;

    /**
     * 주민 수 집계에 한 번에 바인드하는 섬 id 수 — PostgreSQL 바인드 파라미터 상한(32767)보다 한참 작게 잡는다.
     * 섬 id 가 몇 개든 문장 하나당 이만큼만 넘긴다(GROMO-2287).
     */
    static final int ID_CHUNK = 5000;

    private final GroupRepository islands;
    private final GroupMemberRepository members;
    private final FocusSessionDetailRepository details;
    private final IslandFocusAverageRepository snapshots;
    private final Clock clock;

    /** 정리 잡이 남기는 일수 — 이보다 오래된 행을 지운다(섬마다 최신 1행은 예외). */
    @Value("${island.focus-average.retention-days:90}")
    private int retentionDays;

    /**
     * 그날의 스냅샷을 적는다 — 크론이 부르는 진입점이다(잡지 발행과 운영자 수동 실행도 부른다).
     *
     * <p>창의 끝은 «실행된 순간» 이 아니라 <b>그날 07:00 KST</b> 다. 멱등이다 — {@code ON CONFLICT DO NOTHING}
     * 이라 같은 날 두 번 돌아도 처음 적힌 값이 남는다(그 사이 주민·집중이 바뀌어도).
     *
     * <p>지난 날짜를 넘기면 창은 그날 기준이지만 분모(주민 수)·모집단(살아 있는 섬)은 <b>지금</b> 기준이고, 분자도 그 뒤에
     * 끝난 세션의 창 안 구간까지 센다 — 그날 07시 크론이 적었을 값과 다를 수 있다. 이미 적힌 (날짜, 섬)은 덮지 않는다.
     * 07:00 KST 가 지나지 않은 날짜는 넘기지 않는다({@link #lastClosedDate()} — 덜 닫힌 창의 값이 그날 PK 에 박힌다).
     *
     * @param kstDate 실행일(KST 날짜)
     * @return 새로 적힌 행 수. 같은 날 재실행이면 0 이다(그 사이 새로 생긴 섬은 센다). 읽어 둔 목록에서 그사이 죽은
     *     섬은 세지 않으므로 대상 섬 수보다 작을 수 있다
     */
    @Transactional
    public int snapshot(LocalDate kstDate) {
        ZonedDateTime end = kstDate.atTime(SNAPSHOT_HOUR_KST, 0).atZone(ZonePolicy.KST);
        Instant windowEnd = end.toInstant();
        Instant windowStart = end.minusDays(WINDOW_DAYS).toInstant();

        List<UUID> islandIds = islands.findAliveIslandIds();
        if (islandIds.isEmpty()) {
            return 0;
        }
        // 두 집계 모두 «없는 행 = 0» 이다 — 주민이 0명인 섬도, 집중이 없는 섬도 행이 나오지 않는다.
        Map<UUID, Long> memberCounts = countMembers(islandIds, ID_CHUNK);
        Map<UUID, Long> focusSeconds = new HashMap<>();
        details.sumIslandActiveSeconds(windowStart, windowEnd)
                .forEach(row -> focusSeconds.put(row.getIslandId(), row.getSeconds()));

        UUID[] ids = islandIds.toArray(UUID[]::new);
        Integer[] counts = new Integer[ids.length];
        Integer[] averages = new Integer[ids.length];
        for (int i = 0; i < ids.length; i++) {
            int memberCount = Math.toIntExact(memberCounts.getOrDefault(ids[i], 0L));
            counts[i] = memberCount;
            averages[i] = memberCount == 0 ? null
                    : averagePerMemberDay(focusSeconds.getOrDefault(ids[i], 0L), memberCount);
        }

        int inserted = snapshots.insertIfAbsent(kstDate, ids, counts, averages);
        log.info("섬별 7일 평균 집계 date={} 대상 섬={} 새로 적음={}", kstDate, ids.length, inserted);
        return inserted;
    }

    /**
     * 가장 최근에 지난 07:00 KST 의 날짜 — 창이 닫힌 마지막 날이다(D 06:59 KST → D-1, D 07:00 KST → D).
     *
     * <p>수동 실행은 이 날짜까지만 받는다. 07시 전에 D 를 적으면 덜 닫힌 창의 값이 PK 에 박혀, 그날 크론도 D 호 잡지
     * (먼저 이 스냅샷을 부른다)도 다시 적지 못한다.
     */
    public LocalDate lastClosedDate() {
        return ZonedDateTime.now(clock.withZone(ZonePolicy.KST)).minusHours(SNAPSHOT_HOUR_KST).toLocalDate();
    }

    /**
     * {@code asOf} 에서 보존 일수({@code island.focus-average.retention-days}, 기본 90)를 뺀 날보다 오래된 행을 지운다 —
     * 섬마다 최신 1행은 그보다 오래됐어도 남긴다({@link IslandFocusAverageRepository#deleteOlderThanKeepingLatest}).
     * 크론이 스냅샷에 성공한 뒤 같은 락 안에서 부른다.
     *
     * <p>ponytail: 섬 삭제({@code IslandPurgeService})가 같은 섬의 행을 동시에 지우면 행 잠금 순서가 갈려 교착할 수
     * 있다 — 끊기면 이번 정리만 롤백되고 다음 날 크론이 다시 지운다. 잦아지면 재시도를 붙인다.
     *
     * @param asOf 기준일(KST) — 크론의 실행일
     * @return 지운 행 수
     */
    @Transactional
    public int cleanup(LocalDate asOf) {
        LocalDate cutoff = asOf.minusDays(retentionDays);
        int deleted = snapshots.deleteOlderThanKeepingLatest(cutoff);
        log.info("섬별 7일 평균 오래된 행 정리 asOf={} cutoff={} 지움={}", asOf, cutoff, deleted);
        return deleted;
    }

    /** 섬 id 를 {@code chunk} 개씩 끊어 주민 수를 센다 — 청크 경계에서 빠지거나 겹치는 섬이 없다(그룹당 1행이라 합쳐도 같다). */
    Map<UUID, Long> countMembers(List<UUID> islandIds, int chunk) {
        Map<UUID, Long> counts = new HashMap<>();
        for (int from = 0; from < islandIds.size(); from += chunk) {
            members.countByGroupIdIn(islandIds.subList(from, Math.min(from + chunk, islandIds.size())))
                    .forEach(row -> counts.put(row.getGroupId(), row.getMemberCount()));
        }
        return counts;
    }

    /**
     * 주민 1명당 하루 평균(분, 반올림) — {@code round(초 ÷ 60 ÷ 주민 수 ÷ 7)}. 나눗셈을 한 번에 해 오차를
     * 한 번만 낸다.
     */
    private static int averagePerMemberDay(long seconds, int memberCount) {
        return Math.toIntExact(Math.round(seconds / (60.0 * memberCount * WINDOW_DAYS)));
    }
}
