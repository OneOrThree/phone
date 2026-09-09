package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * User 를 <b>id 로 조회</b>하는 경로를 접는다 (GROMO-1655).
 *
 * <p>"모든 User 접근"은 아니다 — 프로젝션 조회({@code JwtFilter} 의 활성 판정,
 * {@code UserTierLookup} 의 티어 배치), 범위 스캔(미접속 복귀 대상), 닉네임 검색,
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
 * <h2>유저에 딸린 1:1 행 — 지갑·설정</h2>
 * 지갑({@code user_wallets})과 설정 3종({@code user_*_settings})은 가입 시
 * {@code AuthService} 가 함께 만드는 유저당 한 행짜리 부속 테이블이라, {@code userId} 가 곧 PK 다.
 * 이 조회도 같은 갈래 문제를 갖고 있었다 — <b>같은 부재를 소유 도메인은 오류로, 빌리는 도메인은
 * 정상으로</b> 취급한다. {@code user}·{@code currency} 는 {@link UserErrorCode#TARGET_USER_NOT_FOUND} 를 던지고
 * (16건), {@code stats}·{@code focus}·{@code screentime}·{@code group}·{@code notification} 은
 * {@code orElse(0)}·{@code orElse(false)}·{@code orElse(null)} 로 조용히 기본값을 쓴다(10건).
 *
 * <p>어느 쪽이 맞는지는 정책 판단이라 <b>이 계층은 두 축을 다 노출하고 판정은 호출부에 남긴다</b> —
 * {@code get*} 은 던지고 {@code find*} 는 {@code Optional} 을 준다. 기본값이 {@code 0} 인지
 * {@code false} 인지는 그 화면의 정책이지 영속성 관심사가 아니다. 통일하기로 하면 그때 고칠 자리는
 * 한 곳이다.
 *
 * <p><b>집중 시간·알림 설정에는 락 판을 만들지 않았다.</b> 두 리포지토리에 락 메서드 자체가
 * 없고 그걸 요구하는 호출부도 없다 — 감춘 게 아니라 그 조합이 존재하지 않는다. 스크린타임만
 * 락 3종이 다 쓰이는데, 권한 회수(배타)와 내기 참가 가드(공유)가 같은 행에서 경합하기 때문이다.
 *
 * <h2>왜 예외가 두 갈래인가</h2>
 * {@code getTarget*} 은 <b>요청이 지목한</b> 유저 부재라 {@link UserErrorCode#TARGET_USER_NOT_FOUND},
 * {@code getCaller*} 는 <b>요청자 본인</b>의 활성 계정 부재라 {@link UserErrorCode#USER_NOT_FOUND} 를
 * 던진다. 앱이 이 code 문자열로 분기하므로(GROMO-1247) 둘을 합치면 계약이 깨진다 — 시그니처로 갈라둔다.
 *
 * <p>지갑·설정 {@code get*} 은 <b>요청자 축</b>이다 — 호출처가 전부 {@code @LoginUser} 본인이고
 * (GROMO-1725 실측: user·currency 뿐), 가입 시 함께 생기는 행이라 부재는 «내 계정이 없다»와 같은
 * 처방(재로그인)이 맞다. 그래서 {@link UserErrorCode#USER_NOT_FOUND} 다(codex 리뷰). 남의 부속 행을
 * 읽는 경로가 생기면 그때 {@code getTargetWallet} 류를 따로 판다.
 */
@Service
@RequiredArgsConstructor
public class UserQueryService {

    private final UserRepository userRepository;
    private final UserWalletRepository userWalletRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
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
     * 요청이 지목한 활성 유저 — <b>배타 락</b>. 이 트랜잭션이 users 행을 변경할 때만 쓴다.
     *
     * @param id 조회 대상
     * @return 활성 유저
     * @throws UserException 없거나 탈퇴했으면 {@link UserErrorCode#TARGET_USER_NOT_FOUND}
     */
    public User getTargetForUpdate(UUID id) {
        return userRepository.findActiveByIdForUpdate(id)
                .orElseThrow(() -> new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));
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
     * <p>관계 '해제'(친구 삭제·핀 해제)처럼 <b>상태를 줄이는</b> 방향의 조작에만 쓴다. 여기에 활성
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
     * 활성 유저 배치 조회 — 티어 정산처럼 여러 명을 한 번에 다룰 때.
     *
     * @param ids 조회 대상
     * @return 활성 유저. <b>탈퇴·부재분은 빠지므로 요청 수와 결과 수가 다를 수 있다.</b> 락이 없어
     *         더티 체킹으로 고치면 전 컬럼 UPDATE 가 나가니, 변경이 목적이면 건별로 락 조회를 쓴다
     */
    public List<User> findAllActive(Collection<UUID> ids) {
        return userRepository.findAllByIdInAndIsDeletedFalse(ids);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 지갑 — 돈이 걸린 행. 변경 트랜잭션은 처음부터 배타 락을 잡는다.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 지갑 조회 — 락 없음. 잔액을 <b>읽기만</b> 하는 경로에서 쓴다.
     *
     * @param userId 지갑 주인
     * @return 지갑
     * @throws UserException 없으면 {@link UserErrorCode#TARGET_USER_NOT_FOUND}. 가입 시 함께 만들어지므로
     *     부재는 사실상 데이터 손상이다
     */
    public UserWallet getWallet(UUID userId) {
        return userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 지갑 조회 — <b>배타 락</b>. 이 트랜잭션이 잔액을 고칠 때 쓴다.
     *
     * <p>여러 유저의 지갑을 한 트랜잭션에서 다루면 {@code userId} 오름차순으로 불러야 교착이 나지
     * 않는다({@link UserWalletRepository} 의 논증 참조). {@code readOnly} 트랜잭션에서는 쓸 수 없다.
     *
     * @param userId 지갑 주인
     * @return 잠긴 지갑
     * @throws UserException 없으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public UserWallet getWalletForUpdate(UUID userId) {
        return userWalletRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 스크린타임 설정 — 유일하게 락 3종이 다 쓰이는 설정이다(권한 회수와 경합한다).
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 스크린타임 설정 — 락 없음. 부재를 오류로 보는 경로용.
     *
     * @param userId 설정 주인
     * @return 설정
     * @throws UserException 없으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public UserScreenTimeSettings getScreenTimeSettings(UUID userId) {
        return userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 스크린타임 설정 — 락 없음, <b>부재가 정상</b>. 기본값으로 대체하는 경로용.
     *
     * <p>기본값이 무엇인지는 호출부가 정한다 — 목표 시간은 {@code 0}, 권한 부여 여부는
     * {@code false} 처럼 화면마다 다르다.
     *
     * @param userId 설정 주인
     * @return 설정. 없으면 빈 값
     */
    public Optional<UserScreenTimeSettings> findScreenTimeSettings(UUID userId) {
        return userScreenTimeSettingsRepository.findById(userId);
    }

    /**
     * 스크린타임 설정 — <b>공유 락</b>, 부재가 정상.
     *
     * <p>권한 회수({@code UserService} 의 배타 락)와 설정 행에서 직렬화한다. 락 없이 읽으면 확인과
     * 차감 사이에 회수가 끼어들어, 보고하지 못하는 유료 참가가 남는다.
     *
     * @param userId 설정 주인
     * @return 잠긴 설정. 없으면 빈 값
     */
    public Optional<UserScreenTimeSettings> findScreenTimeSettingsForShare(UUID userId) {
        return userScreenTimeSettingsRepository.findByIdForShare(userId);
    }

    /**
     * 스크린타임 설정 — <b>배타 락</b>. 이 트랜잭션이 설정을 고칠 때 쓴다.
     *
     * @param userId 설정 주인
     * @return 잠긴 설정
     * @throws UserException 없으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public UserScreenTimeSettings getScreenTimeSettingsForUpdate(UUID userId) {
        return userScreenTimeSettingsRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 스크린타임 설정 배치 조회 — 챌린지 참가자처럼 여러 명을 한 번에 볼 때.
     *
     * @param userIds 설정 주인들
     * @return 설정. <b>부재분은 빠지므로 요청 수와 결과 수가 다를 수 있다</b>
     */
    public List<UserScreenTimeSettings> findAllScreenTimeSettings(Collection<UUID> userIds) {
        return userScreenTimeSettingsRepository.findAllById(userIds);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 집중 시간 설정 · 알림 설정 (락 판이 없는 이유는 클래스 Javadoc 참조)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 집중 시간 설정 — 부재를 오류로 보는 경로용.
     *
     * @param userId 설정 주인
     * @return 설정
     * @throws UserException 없으면 {@link UserErrorCode#USER_NOT_FOUND}
     */
    public UserFocusTimeSettings getFocusTimeSettings(UUID userId) {
        return userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
    }

    /**
     * 집중 시간 설정 — <b>부재가 정상</b>. 통계·집중 화면이 목표 시간을 {@code 0} 으로 대체한다.
     *
     * @param userId 설정 주인
     * @return 설정. 없으면 빈 값
     */
    public Optional<UserFocusTimeSettings> findFocusTimeSettings(UUID userId) {
        return userFocusTimeSettingsRepository.findById(userId);
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
     * 알림 설정 — <b>부재가 정상</b>. 발송 경로는 설정이 없으면 소리를 켠 것으로 본다.
     *
     * @param userId 설정 주인
     * @return 설정. 없으면 빈 값
     */
    public Optional<UserNotificationSettings> findNotificationSettings(UUID userId) {
        return userNotificationSettingsRepository.findById(userId);
    }

    /**
     * 알림 설정 배치 조회 — 묶음 발송이 대상 유저 전체의 설정을 한 번에 읽을 때.
     *
     * @param userIds 설정 주인들
     * @return 설정. <b>부재분은 빠진다</b> — 호출부가 맵으로 만든 뒤 {@code null} 을 기본값으로 접는다
     */
    public List<UserNotificationSettings> findAllNotificationSettings(Collection<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds);
    }
}
