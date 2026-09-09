package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.StatVisibility;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.OccupationInfoRepository;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 계정 프로필·설정·소셜 연동·탈퇴의 도메인 로직.
 *
 * <p><b>락 규율이 메서드마다 다르다</b>(GROMO-801). users 행을 <b>바꾸는</b> 경로(닉네임·직군·국가·
 * 기기 토큰·공개 범위·탈퇴)는 처음부터 배타 락으로 유저를 로드하고, users 를 <b>읽기만</b> 하고 설정
 * 테이블만 건드리는 경로(목표 변경·소셜 연동 해제)는 공유 락으로 로드한다. 공유로 읽고 나중에 UPDATE
 * 하면 락 승급 교착이 나므로 이 분류를 바꾸려면 호출부의 로드 방식까지 함께 봐야 한다.
 *
 * <p><b>닉네임 규칙은 여기 한 곳</b>이다 — 공백 제거 후 2~10자. 사용 가능 여부 검사와 실제 저장이 같은
 * 헬퍼를 공유해 "검사는 통과했는데 저장은 거절"이 생기지 않게 한다. DTO 애노테이션에 맡기지 않은 이유가
 * 그것이다.
 *
 * <p><b>목표 변경의 기준일은 KST 오늘</b>({@link ZonePolicy})이다. 목표는 직전 값이 하루치만 보존되므로
 * 발효일 축이 지급·판정과 어긋나면 어제 데이터가 새 목표로 판정된다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final UserQueryService userQueryService;
    private final UserWalletRepository userWalletRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final OccupationInfoRepository occupationInfoRepository;
    private final UserActivityEventLogger userActivityEventLogger;

    /**
     * 닉네임 규칙 단일점 (GROMO-1215) — trim 후 2~10자. 검사(check API)와 저장(POST/PATCH)이
     * 이 상수·헬퍼를 공유해 "체크는 통과했는데 저장은 거절" 같은 어긋남을 막는다.
     * DTO bean validation 에 기대지 않는 이유: 저장 경로가 둘로 흩어져 있어 어노테이션만으로는
     * 규칙이 갈라지기 쉽고, 검증 주체를 서비스 한 곳으로 고정하는 편이 안전하다.
     */
    private static final int NICKNAME_MIN_LENGTH = 2;
    private static final int NICKNAME_MAX_LENGTH = 10;

    /**
     * 온보딩 프로필 최초 등록 — 닉네임·직군·국가와 두 목표를 한 트랜잭션에서 세운다.
     *
     * <p>닉네임을 <b>가장 먼저</b> 처리한다. 닉네임 저장이 유니크 위반을 잡으려고 flush 를 부르는데,
     * flush 는 그때까지 쌓인 더티 상태를 전부 내보내므로 앞선 변경이 있으면 그쪽의 제약 위반까지
     * 닉네임 중복으로 오인된다.
     *
     * @param userId 온보딩 중인 본인. 탈퇴 계정이거나 설정 행이 없으면 404
     * @param body   프로필 초기값. 목표는 원시 {@code int} 라 "미지정"과 0 이 구분되지 않는다
     * @throws UserException 닉네임 형식 위반(400)·중복(409)·폐기된 직군(400)
     */
    @Transactional
    public void setupProfile(UUID userId, UserProfileSetupRequest body) {
        // users 행(닉네임·직군·국가)을 변경하는 트랜잭션 — 처음부터 배타 락 (GROMO-801 락 선택 원칙,
        // GROMO-1237). 공유 락으로 읽고 나중에 UPDATE 하면 락 승급 교착 대상이 된다.
        User user = userQueryService.getCallerForUpdate(userId);

        changeNickname(user, body.getNickname());
        if (body.getOccupation() != null) {
            requireActiveOccupation(body.getOccupation());
            user.setOccupation(body.getOccupation());
        }
        if (body.getCountryCode() != null) {
            user.setCountryCode(body.getCountryCode());
        }

        LocalDate today = todayOf();
        UserScreenTimeSettings screenSettings = userQueryService.getScreenTimeSettings(userId);
        screenSettings.changeGoal(body.getDailyScreenTimeGoalMinutes(), today);

        UserFocusTimeSettings focusSettings = userQueryService.getFocusTimeSettings(userId);
        focusSettings.changeGoal(body.getDailyFocusTimeGoalMinutes(), today);
    }

    /**
     * 프로필 부분 수정 — <b>null 인 필드는 건드리지 않는다</b>. 빈 문자열 닉네임은 "지움"이 아니라
     * 형식 위반(400)이다.
     *
     * <p>두 목표의 발효일로 같은 날짜 값을 넘긴다. 각자 오늘을 구하면 자정을 걸칠 때 두 설정의 발효일이
     * 하루 어긋나, 방금 끝난 날짜의 리포트가 한쪽은 새 목표로 다른 쪽은 직전 목표로 판정된다.
     *
     * @param userId 본인. 탈퇴 계정이면 404
     * @param body   바꿀 필드만 담긴 요청
     * @throws UserException 닉네임 형식 위반(400)·중복(409)
     */
    @Transactional
    public void updateProfile(UUID userId, UserProfileUpdateRequest body) {
        // users 행(닉네임·국가)을 변경할 수 있는 트랜잭션 — 처음부터 배타 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForUpdate(userId);

        // PATCH 의미론 유지 — null 은 "변경 안 함". 빈문자열·공백-only 는 changeNickname 의
        // 형식 검증(2~10자)이 400 으로 차단한다 (GROMO-1215 — 이전엔 "" 가 그대로 저장되는 구멍).
        if (body.getNickname() != null) {
            changeNickname(user, body.getNickname());
        }
        if (body.getCountryCode() != null) {
            user.setCountryCode(body.getCountryCode());
        }
        // 표시 언어(GROMO-1692) — 푸시 렌더 언어의 정본. 값 검증은 DTO @Pattern 이 400 으로 막는다.
        if (body.getLanguage() != null) {
            user.setLanguage(body.getLanguage());
        }

        // 날짜는 한 번만 구해 두 설정에 같은 값을 넘긴다(코드리뷰) — 각자 todayOf 를 부르면
        // 자정을 걸칠 때 두 설정의 발효일이 하루 어긋나, 방금 끝난 날짜의 리포트가 한쪽은 새 목표로
        // 다른 쪽은 직전 목표로 판정된다.
        // GROMO-1259: 날짜 축이 KST 고정이 되면서 국가 변경은 발효일 계산에 아무 영향이 없다
        // (구 "국가 변경은 목표 이력 정렬 대상이 아니다" 논쟁 자체가 소멸). 목표를 실제로 바꿀 때만
        // 이력을 남기는 규칙은 유지한다.
        LocalDate today = todayOf();
        if (body.getDailyScreenTimeGoalMinutes() != null) {
            UserScreenTimeSettings screenSettings = userQueryService.getScreenTimeSettings(userId);
            screenSettings.changeGoal(body.getDailyScreenTimeGoalMinutes(), today);
        }
        if (body.getDailyFocusTimeGoalMinutes() != null) {
            UserFocusTimeSettings focusSettings = userQueryService.getFocusTimeSettings(userId);
            focusSettings.changeGoal(body.getDailyFocusTimeGoalMinutes(), today);
        }
    }

    /**
     * 닉네임 사용 가능 여부 판정 (GROMO-1215) — 저장 경로(changeNickname)와 같은 규칙을 공유한다.
     * 형식 위반(trim 후 2~10자 밖·빈문자열·null)은 예외 없이 false 로 답한다 — 앱이 로컬 형식검사를
     * 선행해 문구를 구분하고, 서버 판정은 중복 여부의 최종 답이라는 계약(항상 200).
     * 본인 제외(AndIdNot) 조회라 자기 자신의 현재 닉네임은 true — 프로필 편집에서 그대로 저장이
     * "사용 불가"로 뜨지 않는다. 탈퇴자는 nickname=null 로 즉시 해방되므로(withdraw 의 PII 파기)
     * 별도 제외 조건이 필요 없고, nickname = ? 동등 비교는 null 행과 매치되지 않아 안전하다.
     *
     * @param userId      판정 기준 유저(본인) ID
     * @param rawNickname 검사할 닉네임 원문(trim 전)
     * @return 사용 가능하면 true
     */
    public boolean isNicknameAvailable(UUID userId, String rawNickname) {
        String nickname = rawNickname == null ? "" : rawNickname.trim();
        if (!hasValidNicknameLength(nickname)) {
            return false;
        }
        return !userRepository.existsByNicknameAndIdNot(nickname, userId);
    }

    private static boolean hasValidNicknameLength(String trimmedNickname) {
        return trimmedNickname.length() >= NICKNAME_MIN_LENGTH
                && trimmedNickname.length() <= NICKNAME_MAX_LENGTH;
    }

    /**
     * 닉네임 변경의 단일 저장 경로 (GROMO-1215) — setup(POST)·update(PATCH)가 함께 쓴다.
     * ① 형식(trim 후 2~10자) 위반 → 400 NICKNAME_INVALID
     * ② 본인 제외 사전 중복 검사 → 409 NICKNAME_DUPLICATE (GROMO-584)
     * ③ 사전 검사와 동시 저장이 겹친 TOCTOU 레이스 — uq_users_nickname 유니크 제약 위반을
     * flush 시점에 잡아 같은 409 NICKNAME_DUPLICATE 로 강하한다(GroupChallengeService 의
     * saveAndFlush catch 선례). 커밋 시점까지 미루면 전역 폴백(DATA_INTEGRITY_VIOLATION)으로
     * 새어 클라이언트가 원인을 구분할 수 없다.
     *
     * <p>⚠ 이 메서드는 트랜잭션의 <b>첫 mutation 지점</b>이어야 한다 (GROMO-1230). 두 가지 이유다:
     * ① 위 flush() 는 닉네임만 골라 내보내지 못하고 트랜잭션에 쌓인 더티 상태 전부를 밀어낸다 —
     * 앞선 다른 변경이 있으면 그쪽의 제약 위반까지 이 catch 가 409 NICKNAME_DUPLICATE 로 오인
     * 강하한다. 호출측(setup/updateProfile)이 닉네임을 다른 변경보다 먼저 처리하는 순서를 지킬 것.
     * ② 락 규율(GROMO-801, UserRepository 락 선택 원칙) — 여기서 users 행을 변경하므로 이
     * 트랜잭션은 "users 행 변경 = 처음부터 배타 락(findActiveByIdForUpdate)" 분류에 해당한다.
     * 공유 락(ForShare)으로 로드한 트랜잭션에서 이 메서드를 부르면 락 승급 교착 대상이 된다.
     * 현재 호출부(setupProfile·updateProfile)는 배타 락 로드(findActiveByIdForUpdate)로 목표
     * 상태에 도달했다(GROMO-1237) — flush() 는 배타 락과 호환이라 동작 변화가 없다.
     */
    private void changeNickname(User user, String rawNickname) {
        String nickname = rawNickname == null ? "" : rawNickname.trim();
        if (!hasValidNicknameLength(nickname)) {
            throw new UserException(UserErrorCode.NICKNAME_INVALID);
        }
        if (userRepository.existsByNicknameAndIdNot(nickname, user.getId())) {
            throw new UserException(UserErrorCode.NICKNAME_DUPLICATE);
        }
        user.setNickname(nickname);
        try {
            userRepository.flush();
        } catch (DataIntegrityViolationException e) {
            throw new UserException(UserErrorCode.NICKNAME_DUPLICATE);
        }
    }

    /**
     * 목표 이력(GROMO-1049)의 기준일 — KST 오늘 (GROMO-1259).
     * 지급·판정이 KST 날짜 버킷을 쓰므로 발효일도 같은 기준이어야 어긋나지 않는다.
     */
    private LocalDate todayOf() {
        return LocalDate.now(ZonePolicy.KST);
    }

    /**
     * 탈퇴자의 지갑·설정 행을 삭제한다 (GROMO-635 · 분리 GROMO-1656).
     *
     * <p>집중·통계 이력과 달리 이 넷은 <b>하드 삭제</b>다 — 다른 사람의 판정에 쓰이지 않는
     * 개인 소유 행이고, 남겨 두면 재가입 시 옛 목표·권한이 되살아난다.
     *
     * <p><b>호출 순서 제약</b>: 그룹 내기 해제의 환불이 이 유저의 지갑에 입금되므로
     * ({@code GroupMemberService.detachWithdrawnUser}), 그보다 <b>뒤</b>에 불려야 한다 —
     * 지갑을 먼저 지우면 환불이 {@code USER_NOT_FOUND} 로 터진다.
     *
     * @param userId 탈퇴 중인 유저
     */
    @Transactional
    public void deleteWalletAndSettings(UUID userId) {
        userWalletRepository.deleteById(userId);
        userScreenTimeSettingsRepository.deleteById(userId);
        userFocusTimeSettingsRepository.deleteById(userId);
        userNotificationSettingsRepository.deleteById(userId);
    }

    /**
     * 개인정보를 파기하고 계정을 비활성 표시한 뒤 소셜 연동을 끊는다 (GROMO-635, GROMO-801 · 분리 GROMO-1656).
     *
     * <p><b>하드 삭제는 불가능하다</b>: 다수 테이블이 이 유저를 NOT NULL FK 로 참조해
     * ({@code social_accounts} · {@code focus_tags} · {@code user_items} ·
     * {@code currency_transactions} · {@code group_members} · {@code league_arena_users} 등)
     * 이력이 있는 계정은 지워지지 않는다. 그래서 user 행은 남겨 소프트딜리트하고 PII 만 파기한다.
     *
     * <p><b>소셜 연동 삭제가 반드시 맨 끝인 이유</b>(GROMO-801): 그 벌크 DELETE 는
     * {@code clearAutomatically} 로 영속성 컨텍스트를 비우므로, <b>이 호출 뒤에 엔티티를 고치면
     * 전부 조용히 유실된다</b> — 실제로 예전에 PII 파기·소프트딜리트가 이 호출 뒤에 있어 커밋되지
     * 않고 있었다. {@code flushAutomatically} 가 여기까지 쌓인 변경(내기 해제 환불·멤버십 이탈·
     * 지갑 삭제·PII 파기)을 먼저 밀어 넣은 뒤에 컨텍스트를 비운다.
     *
     * <p>그래서 이 메서드는 <b>탈퇴 절차의 마지막</b>이어야 한다. 뒤에 다른 도메인의 정리를 붙이면
     * 그 변경이 커밋되지 않는다 — 컴파일도 테스트도 이것을 잡아 주지 않는다.
     *
     * <p>소셜 연동만 하드 삭제하는 이유는 {@code provider_id} 가 PII 이고, 같은 소셜 계정으로
     * 재가입할 수 있어야 하기 때문이다.
     *
     * @param user 탈퇴 중인 유저. 호출부가 배타 락으로 로드해 둔 엔티티여야 한다
     */
    @Transactional
    public void erasePersonalData(User user) {
        user.setNickname(null);
        user.setDeviceToken(null);
        user.setRefreshTokenHash(null);
        user.setCountryCode(null);
        // 표시 언어도 프로필 개인정보다 — 국가처럼 탈퇴 시 파기 (codex 리뷰, GROMO-1659)
        user.setLanguage(null);
        user.setDeleted(true);

        socialAccountRepository.deleteByUserId(user.getId());
    }

    /**
     * 본인 프로필 조회 — 유저·지갑·두 설정 행을 모두 읽는다.
     *
     * @param userId 본인
     * @return 프로필·잔액·목표와 함께 <b>서버 날짜 버킷 존</b>(KST 고정)을 실어 준다.
     *         앱이 업로드 날짜 키를 서버와 같은 축으로 만들게 하려는 값이다
     * @throws UserException 탈퇴했거나 지갑·설정 행 중 하나라도 없으면 404
     */
    public UserProfileResponse getProfile(UUID userId) {
        User user = userQueryService.getCaller(userId);
        UserWallet wallet = userQueryService.getWallet(userId);
        UserScreenTimeSettings screenSettings = userQueryService.getScreenTimeSettings(userId);
        UserFocusTimeSettings focusSettings = userQueryService.getFocusTimeSettings(userId);

        // 준비 시험(occupation) — enum name 문자열, 미설정이면 null (GROMO-757, 타 유저 공개 프로필과 동일 매핑)
        String occupation = user.getOccupation() != null ? user.getOccupation().name() : null;

        return new UserProfileResponse(
                user.getId(),
                user.getNickname(),
                wallet.getBalance(),
                screenSettings.getDailyScreenTimeGoalMinutes(),
                focusSettings.getDailyFocusTimeGoalMinutes(),
                user.getCountryCode(),
                user.getStatVisibility() != null ? user.getStatVisibility().name() : null,
                occupation,
                // 서버 날짜 버킷 존 — 앱이 업로드 날짜 키를 같은 축으로 만들게 내려준다(GROMO-1252).
                // GROMO-1259 부터 항상 KST 고정(country_code 무관, N8/FR-19 — 해외 유저는 L5 수용).
                ZonePolicy.KST.getId(),
                user.getLanguage());
    }

    /**
     * 개인 통계 공개 범위(FRIENDS/PUBLIC) 수정 + STAT_VISIBILITY_UPDATED 이벤트 발행.
     *
     * @param userId         본인. 탈퇴 계정이면 404
     * @param statVisibility 새 공개 범위. 이 값은 <b>세부 차트에만</b> 걸리고 스트릭·오늘 요약은
     *                       범위와 무관하게 공개된다
     */
    @Transactional
    public void updateStatVisibility(UUID userId, StatVisibility statVisibility) {
        // users 행(stat_visibility) 변경 트랜잭션 — 처음부터 배타 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForUpdate(userId);
        user.setStatVisibility(statVisibility);
        userActivityEventLogger.log(UserActivityEvent.STAT_VISIBILITY_UPDATED,
                Map.of("visibility", statVisibility.name()));
    }

    /**
     * 스크린타임 OS 권한 보유 여부 갱신 — 앱의 보고를 그대로 저장한다(서버가 검증하지 않는다).
     *
     * <p>설정 행을 <b>배타 잠금</b>으로 로드한다. 이 플래그가 유료 회차 참여 가드라, 잠금이 없으면
     * "참여가 true 를 읽음 → 여기서 false 커밋 → 참여가 차감 커밋" 순서에서 보고 수단이 없는 유저가
     * 회차에 남는다(미보고 = 미달성이라 확정 패배다).
     *
     * @param userId  본인
     * @param request 권한 보유 여부
     * @throws UserException 설정 행이 없으면 404
     */
    @Transactional
    public void updateScreenTimePermission(UUID userId, UpdateScreenTimePermissionRequest request) {
        // 배타 잠금 (GROMO-1409·N50) — 내기 참여의 권한 가드가 같은 행을 공유 잠금으로 읽는다.
        // 잠금이 없으면 "참여가 true 를 읽음 → 여기서 false 커밋 → 참여가 차감 커밋" 인터리빙에서
        // 보고 수단이 없는 유저가 유료 회차에 남는다(미보고 = 미달성이라 확정 패배).
        UserScreenTimeSettings settings = userQueryService.getScreenTimeSettingsForUpdate(userId);
        settings.setScreenTimePermissionGranted(request.getGranted());
    }

    /**
     * 일일 스크린타임 목표 변경. users 행은 읽기만 하고 설정 테이블만 바꾸므로 공유 락으로 로드한다.
     *
     * @param userId                     본인. 탈퇴 계정이면 404
     * @param dailyScreenTimeGoalMinutes 새 목표(분). 발효일은 <b>KST 오늘</b>이고, 직전 값은 하루치만
     *                                   보존되므로 그보다 오래된 날짜의 판정은 새 목표로 근사된다
     */
    @Transactional
    public void updateScreenTimeGoal(UUID userId, int dailyScreenTimeGoalMinutes) {
        // users 행은 읽기만(country_code → 오늘 계산)하고 설정 테이블만 변경 — 공유 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForShare(userId);
        UserScreenTimeSettings settings = userQueryService.getScreenTimeSettings(userId);
        settings.changeGoal(dailyScreenTimeGoalMinutes, todayOf());
        userActivityEventLogger.log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "screen_time", "goal_minutes", dailyScreenTimeGoalMinutes));
    }

    /**
     * 일일 집중 시간 목표 변경. 스크린타임 목표와 같은 락·발효일 규칙을 따른다.
     *
     * @param userId                    본인. 탈퇴 계정이면 404
     * @param dailyFocusTimeGoalMinutes 새 목표(분). 발효일은 KST 오늘이고 직전 값은 하루치만 보존된다
     */
    @Transactional
    public void updateFocusTimeGoal(UUID userId, int dailyFocusTimeGoalMinutes) {
        // users 행은 읽기만(country_code → 오늘 계산)하고 설정 테이블만 변경 — 공유 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForShare(userId);
        UserFocusTimeSettings settings = userQueryService.getFocusTimeSettings(userId);
        settings.changeGoal(dailyFocusTimeGoalMinutes, todayOf());
        userActivityEventLogger.log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "focus_time", "goal_minutes", dailyFocusTimeGoalMinutes));
    }

    /**
     * 직군 변경. 마스터에서 폐기된 직군은 저장하지 못한다 — 목록에서 빠진 값이 저장 경로로 새어
     * 들어오는 걸 막는다.
     *
     * <p>직군을 바꿔도 <b>이미 채택한 집중 태그는 그대로</b>다. 직군은 추천 프리셋만 가른다.
     *
     * @param userId     본인. 탈퇴 계정이면 404
     * @param occupation 새 직군. 폐기된 값이면 400
     */
    @Transactional
    public void updateOccupation(UUID userId, Occupation occupation) {
        requireActiveOccupation(occupation);
        // users 행(occupation) 변경 트랜잭션 — 처음부터 배타 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForUpdate(userId);
        user.setOccupation(occupation);
    }

    /**
     * occupation 마스터(occupations)에서 활성(deleted_at IS NULL)인 값만 저장 허용 (GROMO-626, Codex P2).
     * soft-deleted 되어 GET /occupations 에서 빠진 직업을 저장 경로에서도 막아 목록↔저장 정합을 맞춘다.
     */
    private void requireActiveOccupation(Occupation occupation) {
        if (occupation != null && !occupationInfoRepository.existsByCodeAndDeletedAtIsNull(occupation)) {
            throw new UserException(UserErrorCode.OCCUPATION_NOT_AVAILABLE);
        }
    }

    /**
     * 푸시 기기 토큰 등록·갱신. 유저당 <b>토큰 1개</b>만 보관하므로 새 값이 옛 값을 덮는다 —
     * 여러 기기에 동시에 푸시가 가지 않는다.
     *
     * @param userId      본인. 탈퇴 계정이면 404
     * @param deviceToken FCM 등록 토큰. 기기·재설치마다 회전하므로 같은 유저가 반복해서 보낸다
     */
    @Transactional
    public void registerDeviceToken(UUID userId, String deviceToken) {
        // users 행(device_token) 변경 트랜잭션 — 처음부터 배타 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForUpdate(userId);
        user.setDeviceToken(deviceToken);
    }

    /**
     * 토큰 해제 — 로그아웃/기기 변경 시 이전 유저에게 오발송되는 것 방지 (GROMO-528)
     *
     * @param userId 본인. 탈퇴 계정이면 404. 해제 뒤에는 새로 등록할 때까지 이 유저에게 푸시가 가지 않는다
     */
    @Transactional
    public void clearDeviceToken(UUID userId) {
        // users 행(device_token) 변경 트랜잭션 — 처음부터 배타 락 (GROMO-801, GROMO-1237).
        User user = userQueryService.getCallerForUpdate(userId);
        user.setDeviceToken(null);
    }

    /**
     * 유저의 활성 소셜 연동 목록 조회 (deletedAt IS NULL).
     * 게스트(연동 0개)는 빈 리스트 반환.
     *
     * @param userId 본인. 탈퇴 계정이면 404
     * @return 해제되지 않은 연동만. 해제한 연동은 행이 남아 있어도 빠진다
     */
    public List<SocialLinkResponse> getSocialLinks(UUID userId) {
        User user = userQueryService.getCaller(userId);
        return socialAccountRepository.findAllByUserAndDeletedAtIsNull(user).stream()
                .map(account -> new SocialLinkResponse(account.getProvider().name(), account.getCreatedAt()))
                .toList();
    }

    /**
     * 소셜 연동 해제 (소프트딜리트: deletedAt = now()).
     * 마지막 활성 연동 해제 시 409, 미연동 provider 해제 시 404.
     * 비관적 잠금(SELECT FOR UPDATE)으로 count-then-delete TOCTOU race condition 방지:
     * 동시 DELETE 2건이 각각 count를 읽어 409 가드를 우회하는 상황을 차단.
     *
     * <p>소프트딜리트라 같은 소셜 계정으로 다시 로그인하면 이 연동이 되살아난다(탈퇴의 하드 삭제와 다르다).
     *
     * @param userId   본인. 탈퇴 계정이면 404
     * @param provider 해제할 제공자
     * @throws UserException 연동한 적 없는 제공자면 404, <b>마지막 남은 연동</b>이면 409 —
     *         해제하면 로그인 수단이 사라지기 때문이다
     */
    @Transactional
    public void unlinkSocialAccount(UUID userId, Provider provider) {
        // users 행은 읽기만 하고 social_accounts 만 변경 — 공유 락 (GROMO-801, GROMO-1237).
        // 잠금 순서는 user → social_accounts 로 withdraw(배타 락 → social 정리)와 동일 방향이라
        // AB-BA 교착이 없다. 탈퇴가 먼저 커밋되면 재평가로 빈 결과 → USER_NOT_FOUND(404).
        User user = userQueryService.getCallerForShare(userId);
        // 비관적 잠금으로 활성 연동 전체 조회 — count와 대상 계정을 한 번에 확보해 원자성 보장
        List<SocialAccount> activeAccounts = socialAccountRepository.findAllByUserAndDeletedAtIsNullForUpdate(user);
        SocialAccount socialAccount = activeAccounts.stream()
                .filter(a -> a.getProvider() == provider)
                .findFirst()
                .orElseThrow(() -> new UserException(UserErrorCode.SOCIAL_ACCOUNT_NOT_FOUND));
        if (activeAccounts.size() == 1) {
            throw new UserException(UserErrorCode.LAST_SOCIAL_ACCOUNT);
        }
        socialAccount.setDeletedAt(Instant.now());
    }

    /**
     * 알림 설정 현재값 조회 (GROMO-612).
     * LocalTime → "HH:mm" 매핑 (null 허용).
     *
     * @param userId 본인
     * @return 현재 설정. 심야 시각은 시간대를 담지 않는 {@code "HH:mm"} 문자열이고 미설정이면 null 이다
     * @throws UserException 설정 행이 아직 없으면 404
     */
    public NotificationSettingsResponse getNotificationSettings(UUID userId) {
        UserNotificationSettings s = userQueryService.getNotificationSettings(userId);
        return new NotificationSettingsResponse(
                s.isNotificationEnabled(),
                s.isSoundEnabled(),
                s.isNightModeEnabled(),
                s.getNightStartTime() != null ? s.getNightStartTime().toString() : null,
                s.getNightEndTime() != null ? s.getNightEndTime().toString() : null
        );
    }

    /**
     * 알림 설정 저장 — <b>전체 교체</b>다. 세 플래그는 항상 덮어쓰고, 심야 시각은 null 을 보내면
     * "변경 안 함"이 아니라 <b>지움</b>이다.
     *
     * @param userId  본인
     * @param request 새 설정 전체. 시각 문자열은 {@code "HH:mm"} 형식이어야 하며 검증은 요청 DTO 가 한다
     * @throws UserException 설정 행이 아직 없으면 404
     */
    @Transactional
    public void updateNotificationSettings(UUID userId, NotificationSettingsRequest request) {
        UserNotificationSettings settings = userQueryService.getNotificationSettings(userId);
        settings.setNotificationEnabled(request.getNotificationEnabled());
        settings.setSoundEnabled(request.getSoundEnabled());
        settings.setNightModeEnabled(request.getNightModeEnabled());
        // null 입력 시 기존 값을 null 로 명시적 초기화; non-null 일 때만 parse 호출
        settings.setNightStartTime(
                request.getNightStartTime() == null ? null : LocalTime.parse(request.getNightStartTime()));
        settings.setNightEndTime(
                request.getNightEndTime() == null ? null : LocalTime.parse(request.getNightEndTime()));
    }
}
