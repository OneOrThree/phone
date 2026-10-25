package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.support.BannedWords;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserBlockRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.event.UserDisplayNameChangedEvent;
import com.oneorthree.phone.user.support.OnboardingCompletion;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 현재 계정 프로필과 탈퇴 개인정보 파기를 담당한다.
 *
 * <p>사용자 행을 변경하는 경로는 처음부터 배타 락으로 읽는다. 닉네임은 정규화·금칙어·중복 판정 후
 * 다른 프로필 필드보다 먼저 저장해 제약 위반을 닉네임 오류로 정확히 변환한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final UserQueryService userQueryService;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final UserBlockRepository userBlockRepository;
    /**
     * 닉네임 변경 사실을 위로 올리는 통로 (A22 ㋡). {@code user} 는 모든 도메인의 바닥이라 갱신
     * 대상인 {@code group} 을 직접 참조할 수 없다 — 소비자는 동기 리스너라 같은 트랜잭션에서 돈다.
     */
    private final ApplicationEventPublisher eventPublisher;
    /** 온보딩 완료 전이 사건 — 모든 프로필 writer 가 {@link #recordOnboardingTransition} 로만 부른다. */
    private final UserOnboardingEvents onboardingEvents;
    /** 닉네임 금칙어 판정 (GROMO-1986) — 온보딩 최초 입력과 수정이 {@link #changeNickname} 하나를 지난다. */
    private final BannedWords bannedWords;

    /** 새 가입·실제 이름 변경에만 적용한다. 기존 공백 닉네임의 무변경 프로필 저장은 허용한다. */
    private static final int NICKNAME_MIN_LENGTH = 2;
    private static final int NICKNAME_MAX_LENGTH = 10;
    /** Unicode White_Space와 BOM. 앱의 공백 제거 범위와 같다(탭·개행·전각 공백·NBSP 포함). */
    private static final Pattern NICKNAME_WHITESPACE = Pattern.compile("[\\p{IsWhite_Space}\\uFEFF]");

    private static boolean isValidNickname(String nickname) {
        return nickname != null && nickname.length() >= NICKNAME_MIN_LENGTH
                && nickname.length() <= NICKNAME_MAX_LENGTH
                && !NICKNAME_WHITESPACE.matcher(nickname).find();
    }

    /**
     * 닉네임 변경의 단일 저장 경로.
     * ① 형식(공백 없이 2~10 UTF-16 단위) 위반 → 400 NICKNAME_INVALID
     * ② 금칙어 → 400 BANNED_WORD (GROMO-1986). 중복 검사보다 앞이라 판정 순서가 형식 → 금칙어 → 중복이다
     * ③ 본인 제외 사전 중복 검사 («대소문자 무시», GROMO-1996) → 409 NICKNAME_DUPLICATE (GROMO-584)
     * ④ 사전 검사와 동시 저장이 겹친 TOCTOU 레이스 — uq_users_nickname·uq_users_nickname_lower 유니크 제약 위반을
     * flush 시점에 잡아 같은 409 NICKNAME_DUPLICATE 로 강하한다(저장 시점의 예외 처리). 커밋 시점까지 미루면 전역 폴백(DATA_INTEGRITY_VIOLATION)으로
     * 새어 클라이언트가 원인을 구분할 수 없다.
     *
     * <p>⚠ 이 메서드는 트랜잭션의 <b>첫 mutation 지점</b>이어야 한다 (GROMO-1230). 두 가지 이유다:
     * ① 위 flush() 는 닉네임만 골라 내보내지 못하고 트랜잭션에 쌓인 더티 상태 전부를 밀어낸다 —
     * 앞선 다른 변경이 있으면 그쪽의 제약 위반까지 이 catch 가 409 NICKNAME_DUPLICATE 로 오인
     * 강하한다. 호출측이 닉네임을 다른 변경보다 먼저 처리하는 순서를 지킬 것.
     * ② 락 규율(GROMO-801, UserRepository 락 선택 원칙) — 여기서 users 행을 변경하므로 이
     * 트랜잭션은 "users 행 변경 = 처음부터 배타 락(findActiveByIdForUpdate)" 분류에 해당한다.
     * 공유 락(ForShare)으로 로드한 트랜잭션에서 이 메서드를 부르면 락 승급 교착 대상이 된다.
     * 호출부는 배타 락 로드(findActiveByIdForUpdate)로 목표
     * 상태에 도달했다(GROMO-1237) — flush() 는 배타 락과 호환이라 동작 변화가 없다.
     */
    private void changeNickname(User user, String nickname) {
        if (!isValidNickname(nickname)) {
            throw new UserException(UserErrorCode.NICKNAME_INVALID);
        }
        // 금칙어는 중복 검사보다 «앞» 이다 — 뒤에 두면 이미 쓰이는 금칙어 닉네임에 409 가 먼저 나가
        // 앱이 「다른 이름을 쓰세요」로 안내하고, 같은 욕설의 다른 변형을 계속 시도하게 된다.
        bannedWords.requireClean(nickname);
        // 대소문자를 «구분하지 않고» 센다 (GROMO-1996, policy-2026-09-14). 정확 일치만 보면 Alice 와
        // alice 가 둘 다 가입되고, 그 둘이 대소문자 무시 친구 검색 한 질의에 함께 잡혀 정책의
        // 「정확히 일치할 때만」이 깨진다. 최종 방어선은 uq_users_nickname_lower(V89) 다 — 아래 flush 가
        // 잡는 유니크 위반이 이제 그 인덱스에서도 난다.
        if (userRepository.existsByNicknameIgnoreCaseAndIdNot(nickname, user.getId())) {
            throw new UserException(UserErrorCode.NICKNAME_DUPLICATE);
        }
        user.setNickname(nickname);
        try {
            userRepository.flush();
        } catch (DataIntegrityViolationException e) {
            throw new UserException(UserErrorCode.NICKNAME_DUPLICATE);
        }
        // 링크 랜딩이 표시할 «발급자 닉네임»의 정본이 바뀌었다(A22 ㋡). 현행 resolveLanding 은 열
        // 때마다 여기를 다시 읽지만 링크가 분리되면 그 조회가 불가능하다 — 같은 트랜잭션에서
        // 갱신 명령을 만들어 둔다. 직접 호출이 아니라 이벤트인 이유는 의존 방향뿐이다(GROMO-1656):
        // user 는 바닥이라 group 을 참조할 수 없고, 소비자는 동기 @EventListener 라 이 트랜잭션에서 돈다.
        eventPublisher.publishEvent(new UserDisplayNameChangedEvent(user.getId(), nickname));
    }

    /**
     * 탈퇴자의 알림 설정 행을 삭제한다 (GROMO-635 · 분리 GROMO-1656).
     *
     * <p>집중 이력과 달리 알림 설정은 <b>하드 삭제</b>다 — 다른 사람의 판정에 쓰이지 않는
     * 개인 소유 행이고, 남겨 두면 재가입 시 옛 잔액·설정이 되살아난다.
     *
     * @param userId 탈퇴 중인 유저
     */
    @Transactional
    public void deleteSettings(UUID userId) {

        userNotificationSettingsRepository.deleteById(userId);
    }

    /**
     * 개인정보를 파기하고 계정을 비활성 표시한 뒤 소셜 연동을 끊는다 (GROMO-635, GROMO-801 · 분리 GROMO-1656).
     *
     * <p><b>하드 삭제는 불가능하다</b>: 다수 테이블이 이 유저를 NOT NULL FK 로 참조해
     * ({@code currency_transactions} · {@code group_members} 등)
     * 이력이 있는 계정은 지워지지 않는다. 그래서 user 행은 남겨 소프트딜리트하고 PII 만 파기한다.
     *
     * <p><b>소셜 연동 삭제가 반드시 맨 끝인 이유</b>(GROMO-801): 그 벌크 DELETE 는
     * {@code clearAutomatically} 로 영속성 컨텍스트를 비우므로, <b>이 호출 뒤에 엔티티를 고치면
     * 전부 조용히 유실된다</b> — 실제로 예전에 PII 파기·소프트딜리트가 이 호출 뒤에 있어 커밋되지
     * 않고 있었다. {@code flushAutomatically} 가 여기까지 쌓인 변경(멤버십 이탈·
     * 설정 삭제·PII 파기)을 먼저 밀어 넣은 뒤에 컨텍스트를 비운다.
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
        // 차단은 양방향 벌크 DELETE 다. 엔티티 변경보다 먼저 두어 아래 소셜 벌크의 clear 와 순서가 섞이지 않게 한다.
        userBlockRepository.deleteAllInvolving(user.getId());

        user.setNickname(null);
        user.setCountryCode(null);
        // 표시 언어도 프로필 개인정보다 — 국가처럼 탈퇴 시 파기 (codex 리뷰, GROMO-1659)
        user.setLanguage(null);
        // 고양이 색도 직접 프로필 필드다(GROMO-1945) — 추가한 PR 에서 함께 파기한다.
        user.setCatColor(null);
        user.setDeleted(true);

        socialAccountRepository.deleteByUserId(user.getId());
    }

    /**
     * 공개 {@code PATCH /me} 의 프로필 변경 (GROMO-1801·1945 · 계정 LLD §2.3).
     *
     * <p>이름은 기존 닉네임 writer({@link #changeNickname})에 그대로 위임한다 — 공백·길이·중복 정책을 새로 만들지 않는다.
     * 요청 원문이 지금 이름과 같으면 기존 공백 닉네임도 보존하며 writer 를 돌리지 않는다: 돌리면 표시정보 변경 사건이 한 번 더 나간다.
     * 이름을 먼저 바꾸는 이유는 {@link #changeNickname} 이 TX 의 첫 변경이어야 해서다. 두 입력을 모두 적용한 뒤에
     * 완료 전이를 판정한다.
     *
     * @param userId   본인. 호출부가 같은 TX 에서 이미 배타 락을 잡았다(재진입이라 대기하지 않는다)
     * @param rawName  요청 원문. {@code null} 이면 이름을 건드리지 않는다
     * @param catColor 카탈로그({@code CatColors})에서 검증된 색. {@code null} 이면 건드리지 않는다
     * @return 변경 뒤 사용자와 이번 변경이 적은 사건(없으면 빈 목록)
     * @throws UserException 400 {@code NICKNAME_INVALID} · 409 {@code NICKNAME_DUPLICATE}
     */
    @Transactional
    public PublicProfileChange updatePublicProfile(UUID userId, String rawName, String catColor) {
        User user = userQueryService.getCallerForUpdate(userId);
        boolean wasComplete = OnboardingCompletion.isComplete(user);
        if (rawName != null && !rawName.equals(user.getNickname())) {
            changeNickname(user, rawName);
        }
        if (catColor != null) {
            user.setCatColor(catColor);
        }
        return new PublicProfileChange(user, recordOnboardingTransition(user, wasComplete));
    }

    /**
     * 완료 전이의 공통 경계 (계정 LLD §2.3 「모든 프로필 writer 의 공통 책임」). 요청의 완료 입력을 <b>모두</b> 적용한
     * 뒤에 부른다 — 변경 전 판정이 false 이고 지금이 true 일 때만 같은 TX 에 {@code user.onboarded} 를 적는다.
     * true→true·무변경·receipt 재생(본문이 돌지 않는다)은 사건을 만들지 않는다.
     */
    private List<EventEnvelope> recordOnboardingTransition(User user, boolean wasComplete) {
        if (wasComplete || !OnboardingCompletion.isComplete(user)) {
            return List.of();
        }
        return List.of(onboardingEvents.recordOnboarded(user.getId()));
    }

    /**
     * @param user   변경 뒤 사용자
     * @param events 이번 변경이 적은 봉투 — 공개 receipt 의 {@code events}
     */
    public record PublicProfileChange(User user, List<EventEnvelope> events) {
    }

    /**
     * 활성 소셜 연동의 provider 이름 — 소문자·중복 제거·오름차순 (계정 LLD §2.2 linkedProviders).
     * 소프트 해제된 연동은 빠지고, 게스트면 빈 목록이다.
     *
     * @param user 활성 사용자
     * @return 예: {@code ["apple", "kakao"]}
     */
    public List<String> linkedProviderNames(User user) {
        return socialAccountRepository.findAllByUserAndDeletedAtIsNull(user).stream()
                .map(account -> account.getProvider().name().toLowerCase(Locale.ROOT))
                .distinct().sorted().toList();
    }

}
