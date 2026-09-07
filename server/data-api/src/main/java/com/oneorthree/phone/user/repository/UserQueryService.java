package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * User 를 <b>id 로 조회</b>하는 경로의 단일 진입점 (GROMO-1655).
 *
 * <p>"모든 User 접근"은 아니다 — 프로젝션 조회({@code JwtFilter} 의 활성 판정,
 * {@code LeagueTierLookup} 의 티어 배치), 범위 스캔(미접속 복귀 대상), 닉네임 검색,
 * 저장·수정은 여전히 {@link UserRepository} 를 직접 쓴다. 특히 <b>탈퇴자 401 게이트</b>는
 * 이 계층이 아니라 {@code JwtFilter} 에 있다(GROMO-827) — 계층만 감사하면 그 게이트를 놓친다.
 *
 * <p>종전엔 19개 service 가 {@code userRepository} 를 직접 들고 {@code find*(...).orElseThrow(...)}
 * 를 51번 되풀이했는데, 그 과정에서 <b>같은 "활성 유저 한 명"을 네 가지로 조회</b>하고 있었다 —
 * 소프트딜리트 필터를 쿼리로 거는 곳({@code findByIdAndIsDeletedFalse}), 조회 후 본문에서
 * {@code isDeleted()} 로 거르는 곳, {@code Optional.filter} 로 거르는 곳, <b>아예 안 거르는 곳</b>.
 * 이 클래스가 그 갈래를 하나로 접는다.
 *
 * <p><b>이 클래스는 트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여할 뿐이다.
 * 아래 락 메서드는 {@code FOR SHARE}/{@code FOR UPDATE} 를 걸므로 <b>트랜잭션 밖에서 부르면 락이
 * 아무 일도 하지 않는다</b> — 호출측이 {@code @Transactional} 안에 있는지 확인할 책임을 진다.
 *
 * <h2>왜 락을 감추지 않는가</h2>
 * 락 선택은 취향이 아니라 정확성 결정이라 호출부가 골라야 한다({@link UserRepository} 의 상세 논증 참조).
 * <ul>
 *   <li><b>그 트랜잭션이 users 행을 변경하면 처음부터 {@code ForUpdate}</b> — 공유 락으로 읽고 나중에
 *       UPDATE 하면 같은 행을 잡은 두 트랜잭션이 서로의 공유 락 해제를 기다리며 <b>락 승급 교착</b>으로 죽는다</li>
 *   <li><b>users 를 읽기만 하는 트랜잭션은 {@code ForShare}</b> — 병렬성을 지키면서
 *       "빈 결과 = 탈퇴 확정"(GROMO-1230, Postgres EvalPlanQual 재평가) 전제를 얻는다</li>
 *   <li>탈퇴와 경합할 일이 없는 단순 조회는 락 없는 쪽을 쓴다</li>
 * </ul>
 *
 * <h2>왜 예외가 두 갈래인가</h2>
 * {@code getTarget*} 은 <b>요청이 지목한</b> 유저 부재라 {@link UserErrorCode#NOT_FOUND},
 * {@code getCaller*} 는 <b>요청자 본인</b>의 활성 계정 부재라 {@link UserErrorCode#USER_NOT_FOUND} 를
 * 던진다. 앱이 이 code 문자열로 분기하므로(GROMO-1247) 둘을 합치면 계약이 깨진다 — 시그니처로 갈라둔다.
 */
@Service
@RequiredArgsConstructor
public class UserQueryService {

    private final UserRepository userRepository;

    /**
     * 활성 유저 조회 — 없으면 빈 값. 부재가 정상 흐름인 곳(스킵·기본값 대체)에서 쓴다.
     *
     * @param id 조회 대상
     * @return 활성 유저. 없거나 탈퇴했으면 빈 값. 락이 없어 반환 직후 탈퇴가 커밋될 수 있다
     */
    public Optional<User> findActive(UUID id) {
        return userRepository.findByIdAndIsDeletedFalse(id);
    }

    /**
     * 요청이 지목한 활성 유저 — 락 없음.
     *
     * @param id 조회 대상
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#NOT_FOUND}
     */
    public User getTarget(UUID id) {
        return findActive(id).orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    /**
     * 요청자 본인의 활성 계정 — 락 없음.
     *
     * @param id 요청자
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public User getCaller(UUID id) {
        return findActive(id).orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 활성 유저 조회 — <b>배타 락</b>, 없으면 빈 값.
     *
     * <p>부재가 정상 흐름인 락 경로를 위한 것이다. 예: 리그 주간 정산은 집계 시점 이후에 탈퇴한
     * 유저를 만나면 예외가 아니라 <b>스킵</b>으로 처리해야 한다({@code SKIPPED_WITHDRAWN}) —
     * 한 명 때문에 배치 전체가 죽으면 안 된다. 던지는 쪽이 필요하면 {@link #getTargetForUpdate}.
     *
     * @param id 조회 대상
     * @return 활성 유저. 없거나 탈퇴했으면 빈 값 — 락 대기 중 탈퇴가 커밋되면
     *         술어 재평가로 빈 결과가 되고, 그것이 "탈퇴 확정" 신호다(GROMO-1230)
     */
    public Optional<User> findActiveForUpdate(UUID id) {
        return userRepository.findActiveByIdForUpdate(id);
    }

    /**
     * 요청이 지목한 활성 유저 — <b>공유 락</b>. users 를 읽기만 하는 트랜잭션에서 쓴다.
     *
     * @param id 조회 대상
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#NOT_FOUND}
     */
    public User getTargetForShare(UUID id) {
        return userRepository.findActiveByIdForShare(id)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    /**
     * 요청자 본인의 활성 계정 — <b>공유 락</b>.
     *
     * @param id 요청자
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public User getCallerForShare(UUID id) {
        return userRepository.findActiveByIdForShare(id)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 요청이 지목한 활성 유저 — <b>배타 락</b>. 이 트랜잭션이 users 행을 변경할 때만 쓴다.
     *
     * @param id 조회 대상
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#NOT_FOUND}
     */
    public User getTargetForUpdate(UUID id) {
        return userRepository.findActiveByIdForUpdate(id)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    /**
     * <b>탈퇴자를 포함한</b> 유저 조회 — 락 없음. 활성 필터를 <b>일부러 걸지 않는</b> 유일한 창구다.
     *
     * <p>관계 '해제'(친구 삭제·핀 해제)처럼 <b>상태를 줄이는</b> 방향의 조작에만 쓴다. 여기에 활성
     * 검증을 걸면 상대가 탈퇴한 순간 잔존 관계를 영구히 못 지운다(GROMO-801). 해제는 유령을 늘리지
     * 않으므로 탈퇴자를 대상으로 허용해도 안전하다.
     *
     * <p><b>새 관계를 만들거나 유저 상태를 바꾸는 경로에는 쓰지 말 것</b> — 그쪽은
     * {@link #getTarget(UUID)}·{@link #getTargetForShare(UUID)} 계열이다.
     *
     * @param id 조회 대상
     * @return 유저. <b>탈퇴(소프트딜리트)했어도 그대로 반환한다</b>
     * @throws UserException 행 자체가 없으면 {@link UserErrorCode#NOT_FOUND}
     */
    public User getAny(UUID id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    /**
     * 활성 유저 배치 조회 — 티어 정산처럼 여러 명을 한 번에 다룰 때.
     *
     * @param ids 조회 대상
     * @return 활성 유저. <b>탈퇴·부재분은 빠지므로 요청 수와 결과 수가 다를 수 있다.</b> 락이 없어
     *         더티 체킹으로 고치면 전 컬럼 UPDATE 가 나가니, 변경이 목적이면 건별로 락 조회를 쓴다
     */
    public List<User> findAllActive(Collection<UUID> ids) {
        return userRepository.findAllByIdInAndIsDeletedFalse(ids);
    }
}
