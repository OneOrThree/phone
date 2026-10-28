package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 활성 사용자와 알림 설정을 조회하는 공통 경계다.
 *
 * <p>사용자 행을 변경하는 호출자는 배타 락, 읽기만 하는 트랜잭션은 공유 락을 선택한다.
 * 이 클래스는 트랜잭션을 시작하지 않으므로 락 조회는 호출자의 트랜잭션 안에서 수행해야 한다.
 * 요청자 부재는 USER_NOT_FOUND, 대상 부재는 TARGET_USER_NOT_FOUND로 구분한다.
 */
@Service
@RequiredArgsConstructor
public class UserQueryService {

    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;

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
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#TARGET_USER_NOT_FOUND}
     */
    public User getTarget(UUID id) {
        return findActive(id).orElseThrow(() -> new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));
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
     * @param id 조회 대상
     * @return 활성 유저. 없거나 탈퇴했으면 빈 값 — 락 대기 중 탈퇴가 커밋되면
     *         술어 재평가로 빈 결과가 되고, 그것이 "탈퇴 확정" 신호다(GROMO-1230)
     */
    public Optional<User> findActiveForUpdate(UUID id) {
        return userRepository.findActiveByIdForUpdate(id);
    }

    /**
     * 활성 유저 조회 — <b>공유 락</b>, 없으면 빈 값. 부재가 정상 흐름(스킵)인 읽기 트랜잭션용이다.
     *
     * <p>예: 비동기 알림의 발송 기록은 호출자가 없어 404 를 돌려줄 곳이 없다 — 탈퇴가 먼저 커밋됐으면
     * 기록만 건너뛴다(GROMO-1944). 던지는 쪽이 필요하면 {@link #getCallerForShare}·{@link #getTargetForShare}.
     *
     * @param id 조회 대상
     * @return 잠긴 활성 유저. 락 대기 중 탈퇴가 커밋되면 술어 재평가로 빈 값이 된다(GROMO-1230)
     */
    public Optional<User> findActiveForShare(UUID id) {
        return userRepository.findActiveByIdForShare(id);
    }

    /**
     * 요청이 지목한 활성 유저 — <b>공유 락</b>. users 를 읽기만 하는 트랜잭션에서 쓴다.
     *
     * @param id 조회 대상
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#TARGET_USER_NOT_FOUND}
     */
    public User getTargetForShare(UUID id) {
        return userRepository.findActiveByIdForShare(id)
                .orElseThrow(() -> new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));
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
     * 요청자 본인의 활성 계정 — <b>배타 락</b>. 이 트랜잭션이 요청자의 users 행을 변경할 때 쓴다
     * (프로필 수정·탈퇴·캐릭터 생성 등). GROMO-1725 에서 요청자 부재를 전 도메인
     * {@link UserErrorCode#USER_NOT_FOUND} 로 통일하면서 생겼다.
     *
     * @param id 요청자
     * @return 잠긴 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public User getCallerForUpdate(UUID id) {
        return findActiveForUpdate(id)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * <b>탈퇴자를 포함한</b> 유저 조회 — 락 없음. 활성 필터를 <b>일부러 걸지 않는</b> 유일한 창구다.
     *
     * <p>관계 '해제'(친구 삭제)처럼 <b>상태를 줄이는</b> 방향의 조작에만 쓴다. 여기에 활성
     * 검증을 걸면 상대가 탈퇴한 순간 잔존 관계를 영구히 못 지운다(GROMO-801). 해제는 유령을 늘리지
     * 않으므로 탈퇴자를 대상으로 허용해도 안전하다.
     *
     * <p><b>새 관계를 만들거나 유저 상태를 바꾸는 경로에는 쓰지 말 것</b> — 그쪽은
     * {@link #getTarget(UUID)}·{@link #getTargetForShare(UUID)} 계열이다.
     *
     * @param id 조회 대상
     * @return 유저. <b>탈퇴(소프트딜리트)했어도 그대로 반환한다</b>
     * @throws UserException 행 자체가 없으면 {@link UserErrorCode#TARGET_USER_NOT_FOUND}
     */
    public User getAny(UUID id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));
    }

    /**
     * 활성 유저 배치 조회 — 여러 명의 표시 정보를 한 번에 다룰 때.
     *
     * @param ids 조회 대상
     * @return 활성 유저. <b>탈퇴·부재분은 빠지므로 요청 수와 결과 수가 다를 수 있다.</b> 락이 없어
     *         더티 체킹으로 고치면 전 컬럼 UPDATE 가 나가니, 변경이 목적이면 건별로 락 조회를 쓴다
     */
    public List<User> findAllActive(Collection<UUID> ids) {
        return userRepository.findAllByIdInAndIsDeletedFalse(ids);
    }

    /**
     * 알림 설정 — 부재를 오류로 보는 경로용.
     *
     * @param userId 설정 주인
     * @return 설정
     * @throws UserException 없으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public UserNotificationSettings getNotificationSettings(UUID userId) {
        return userNotificationSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 알림 설정 — <b>배타 락</b>. 이 트랜잭션이 설정을 고칠 때 쓴다 (GROMO-1659).
     *
     * <p>잠금을 <b>상태 판독 앞에</b> 둔다. 뒤에 두면(예: 락 없이 읽고 version 발급에서만 직렬화)
     * 이미 낡은 값을 읽은 뒤라 순서가 고쳐지지 않고, Hibernate 가 「변경 없음」으로 UPDATE 를 생략해
     * 행은 먼저 커밋된 값 · 봉투는 더 높은 version 의 다른 값으로 갈라진다.
     *
     * <p><b>파기(soft delete) 필터는 붙이지 않는다 — 락만 다른 {@link #getNotificationSettings} 의
     * 짝이기 때문이다.</b> 이름·예외·부재 취급이 그 메서드와 같고 «잠금 강도»만 다르다
     *
     * 이 클래스가 소프트딜리트를 접는 것은 {@code users} 축({@code getCaller*}·{@code getTarget*})이고,
     * 부속 설정 행의 {@code deletedAt} 은 지금 호출부마다 취급이 갈려 있어 어느 쪽으로도 접지 않는다 —
     * 여기서 한쪽으로 접으면 다른 호출부의 계약이 조용히 바뀐다. 파기를 오류로 보는 호출부는
     * 받은 행에서 직접 판정한다.
     *
     * @param userId 설정 주인
     * @return 잠긴 설정
     * @throws UserException 없으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public UserNotificationSettings getNotificationSettingsForUpdate(UUID userId) {
        return userNotificationSettingsRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

}
