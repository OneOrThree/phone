package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.QueryHints;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 초대 링크 클릭 저장소 — deferred 어트리뷰션의 상태 기계가 여기 얹혀 있다.
 * 한 행은 <b>클릭 → 매치(기기 연결) → claim(유저 연결)</b> 순으로 한 방향으로만 전이한다.
 *
 * <p>전이 두 개는 각각 "한 클릭은 한 기기에만", "한 클릭은 한 유저에게만" 이라는 유일성 계약을 갖는데,
 * DB 제약이 아니라 <b>비관적 락으로</b> 지킨다. 그래서 소진용 조회 두 개는 반드시
 * {@code PESSIMISTIC_WRITE} + {@code SKIP LOCKED} 로 가져와야 하고, 락 없는 경로로 같은 행을
 * 읽어 상태를 바꾸면 계약이 조용히 깨진다.
 */
public interface InviteLinkClickRepository extends JpaRepository<InviteLinkClick, UUID> {

    /** Hibernate 에서 {@code FOR UPDATE SKIP LOCKED} 를 뜻하는 lock timeout 매직값. */
    String SKIP_LOCKED = "-2";

    /**
     * deferred 매치 후보 — 같은 IP해시+OS 로 시간창 안에 찍힌 <b>미소진</b> 클릭 중 가장 최근 1건.
     *
     * <p>{@code PESSIMISTIC_WRITE}(SELECT … FOR UPDATE)로 잠근다. 잠그지 않으면 동시에 들어온 두
     * 매치 요청이 같은 클릭을 읽고 둘 다 소진 처리해, 한 클릭이 두 기기에 매치된다.
     *
     * <p>{@code SKIP LOCKED} 를 함께 쓰는 이유는 PostgreSQL 의 {@code FOR UPDATE} + {@code LIMIT}
     * 조합 때문이다. 그냥 기다리면, 잠금이 풀린 뒤 그 행이 조건에서 탈락했을 때 Postgres 는 다음
     * 후보를 다시 찾지 않고 <b>빈 결과</b>를 준다. 공유 Wi-Fi(같은 fingerprint)에서 후보가 여러 건
     * 쌓인 상황이 정확히 그 조건이라, 아직 남은 후보가 있는데도 매치 실패가 된다.
     *
     * @param ipHash 원문 IP 가 아니라 솔트 해시. 프록시 헤더 신뢰 규칙이 흔들리면 이 키가 흔들려
     *               매칭 정확도가 그대로 떨어진다
     * @param os 기기 OS. IP 만으로는 공유 Wi-Fi 에서 후보가 뭉치므로 축을 하나 더 둔다
     * @param clickedAfter 시간창의 시작. 이 값이 넓을수록 남의 클릭을 물어 갈 확률이 커지고,
     *                     좁을수록 스토어를 거치며 지연된 정상 설치를 놓친다
     * @return 잠긴 채로 돌아온 후보 1건. empty 는 "후보 없음"뿐 아니라
     *         "남은 후보를 남이 잠그고 있음"(SKIP LOCKED) 도 뜻한다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = SKIP_LOCKED))
    Optional<InviteLinkClick> findFirstByIpHashAndOsAndMatchedFalseAndClickedAtAfterOrderByClickedAtDesc(
            String ipHash, String os, Instant clickedAfter);

    /**
     * claim 대상 — 해당 링크에서 매치까지 간 클릭 중 아직 유저가 안 붙은 가장 최근 1건.
     *
     * <p>매치 후보 조회와 같은 이유로 {@code PESSIMISTIC_WRITE} + {@code SKIP LOCKED} 다. 잠그지 않으면
     * 같은 slug 로 거의 동시에 claim 한 두 유저가 둘 다 {@code claimedUserId == null} 을 읽고 각자
     * 덮어써서, "최초 1회만 기록" 계약이 마지막 커밋 승리(lost update)로 뒤집힌다. SKIP LOCKED 라
     * 늦게 온 쪽은 기다리지 않고 다음 미claim 행(없으면 no-op)으로 넘어간다.
     *
     * @param linkId claim 하려는 초대 링크
     * @return 잠긴 채로 돌아온 미claim 클릭 1건. empty 면 호출부는 실패가 아니라 no-op 으로 접는다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = SKIP_LOCKED))
    Optional<InviteLinkClick> findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNullOrderByMatchedAtDesc(UUID linkId);

    /**
     * 이 기기가 이미 매치해 간 클릭 — 재시도 멱등의 근거.
     *
     * <p>{@code /l/match} 응답이 유실되면 앱은 같은 deviceId 로 재시도한다. 이 조회 없이 후보 소진부터
     * 하면 설치 1건이 클릭을 여러 건 소진하고 호출마다 다른 초대를 받을 수 있다. 읽기만 하므로 락은 없다.
     *
     * @param matchedDeviceId 앱이 보고한 설치 식별자. 외부 입력이라 남의 값을 참칭하면 남의 매치 결과를
     *                        되읽을 수 있으므로, 이 조회 결과로 상태를 바꾸지 않는다(읽기 전용 멱등)
     * @param matchedAfter 재시도로 인정할 시간창의 시작. 이보다 오래된 매치는 새 설치로 본다
     * @return 이 기기가 이미 가져간 클릭. 있으면 후보 소진 없이 같은 결과를 그대로 다시 돌려준다
     */
    Optional<InviteLinkClick> findFirstByMatchedDeviceIdAndMatchedAtAfterOrderByMatchedAtDesc(
            String matchedDeviceId, Instant matchedAfter);

    /**
     * 링크별 클릭 목록 — 지금은 테스트가 상태 전이를 검증하는 데 쓰고, 링크별 집계의 조회 경로이기도 하다.
     *
     * @param linkId 대상 초대 링크
     * @return 그 링크의 모든 클릭. 페이징도 상한도 없으므로 <b>많이 클릭된 링크에 요청 경로에서 쓰면
     *         행 수만큼 그대로 메모리에 올라온다</b> — 집계가 필요해지면 카운트 쿼리로 바꿔야 한다
     */
    List<InviteLinkClick> findByLinkId(UUID linkId);
}
