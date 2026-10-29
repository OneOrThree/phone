package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.support.BannedWords;
import com.oneorthree.phone.user.event.UserDisplayNameChangedEvent;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserBlockRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private SocialAccountRepository socialAccountRepository;
    @Mock
    private UserBlockRepository userBlockRepository;
    @Mock
    private ApplicationEventPublisher eventPublisher;
    @Mock
    private UserOnboardingEvents onboardingEvents;
    @Mock
    private BannedWords bannedWords;
    @InjectMocks
    private UserService userService;

    @Test
    void publicProfilePublishesValidName() {
        User user = currentUser();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updatePublicProfile(USER_ID, "새이름", "black");

        assertThat(user.getNickname()).isEqualTo("새이름");
        assertThat(user.getCatColor()).isEqualTo("black");
        verify(bannedWords).requireClean("새이름");
        verify(eventPublisher).publishEvent(new UserDisplayNameChangedEvent(USER_ID, "새이름"));
    }

    @Test
    void sameNameDoesNotPublishAgain() {
        User user = currentUser();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updatePublicProfile(USER_ID, "기존이름", null);

        verify(userRepository, never()).flush();
        verify(eventPublisher, never()).publishEvent(any(UserDisplayNameChangedEvent.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "가", "\u2003\u2003", "가나다라마바사아자차카", "검은 고양이", " 새이름",
            "새이름 ", "검은\t고양이", "검은\n고양이", "검은\u3000고양이", "검은\u00a0고양이",
            "검은\u0085고양이", "검은\ufeff고양이", "검은\u2028고양이", "검은\u202f고양이"})
    void invalidNameDoesNotChangeProfile(String name) {
        User user = currentUser();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        assertThatThrownBy(() -> userService.updatePublicProfile(USER_ID, name, "black"))
                .isInstanceOf(UserException.class).extracting("errorCode").isEqualTo(UserErrorCode.NICKNAME_INVALID);
        assertThat(user.getNickname()).isEqualTo("기존이름");
        assertThat(user.getCatColor()).isEqualTo("white");
    }

    @Test
    void unchangedLegacyWhitespaceNameCanChangeColorWithoutPublishing() {
        User user = currentUser();
        user.setNickname("검은 고양이");
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updatePublicProfile(USER_ID, "검은 고양이", "black");

        assertThat(user.getNickname()).isEqualTo("검은 고양이");
        assertThat(user.getCatColor()).isEqualTo("black");
        verify(userRepository, never()).flush();
        verify(eventPublisher, never()).publishEvent(any(UserDisplayNameChangedEvent.class));
    }

    @Test
    void duplicateNameIsRejectedBeforeProfileMutation() {
        User user = currentUser();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userRepository.existsByNicknameIgnoreCaseAndIdNot("새이름", USER_ID)).willReturn(true);

        assertThatThrownBy(() -> userService.updatePublicProfile(USER_ID, "새이름", "black"))
                .isInstanceOf(UserException.class).extracting("errorCode").isEqualTo(UserErrorCode.NICKNAME_DUPLICATE);
        assertThat(user.getCatColor()).isEqualTo("white");
    }

    @Test
    void concurrentNameConflictKeepsDomainError() {
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(currentUser());
        doThrow(new DataIntegrityViolationException("uq_users_nickname_lower")).when(userRepository).flush();

        assertThatThrownBy(() -> userService.updatePublicProfile(USER_ID, "새이름", null))
                .isInstanceOf(UserException.class).extracting("errorCode").isEqualTo(UserErrorCode.NICKNAME_DUPLICATE);
    }

    @Test
    void withdrawalDeletesNotificationSettings() {
        userService.deleteSettings(USER_ID);

        verify(userNotificationSettingsRepository).deleteById(USER_ID);
    }

    @Test
    void withdrawalErasesPersonalDataAndSocialLinks() {
        User user = currentUser();
        user.setCountryCode("KR");
        user.setLanguage("ja");

        userService.erasePersonalData(user);

        assertThat(user.isDeleted()).isTrue();
        assertThat(user.getNickname()).isNull();
        assertThat(user.getCatColor()).isNull();
        assertThat(user.getCountryCode()).isNull();
        assertThat(user.getLanguage()).isNull();
        verify(userBlockRepository).deleteAllInvolving(USER_ID);
        verify(socialAccountRepository).deleteByUserId(USER_ID);
        verify(userRepository, never()).delete(any());
    }

    private User currentUser() {
        return User.builder().id(USER_ID).nickname("기존이름").catColor("white").build();
    }
}
