package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.OccupationDefaultTag;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagsResponse;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.OccupationDefaultTagRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserStreakService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.SliceImpl;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * FocusService 단위 테스트 골격.
 *
 * <p>대상: 집중 태그 CRUD, 집중 세션 조회/저장.
 * 핵심 검증 포인트는 (1) 유저 존재 여부, (2) 태그 소유권(FORBIDDEN),
 * (3) 세션 시간 유효성(시작/종료 null·역전).
 */
@ExtendWith(MockitoExtension.class)
class FocusServiceTest {

    @InjectMocks
    private FocusService focusService;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private UserFocusTagRepository userFocusTagRepository;

    @Mock
    private DefaultTagRepository defaultTagRepository;

    @Mock
    private OccupationDefaultTagRepository occupationDefaultTagRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;

    @Mock
    private UserStreakService userStreakService;

    @Mock
    private LeagueArenaUserRepository leagueArenaUserRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID TAG_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");

    private static final Instant START = Instant.parse("2026-06-23T01:00:00Z");
    private static final Instant END = Instant.parse("2026-06-23T02:00:00Z");

    // GROMO-646: recordCompletion 이 리그 갱신을 호출한다. 기본은 아레나 미배정(empty)로 두고,
    // 리그 반영 검증 테스트만 개별로 Optional.of(member) 오버라이드. lenient — recordCompletion 안 타는
    // 테스트(태그 CRUD·예외 조기 return 등)에서 미사용이어도 strict stubbing 위반이 되지 않도록.
    @BeforeEach
    void stubLeagueArenaLookup() {
        lenient().when(leagueArenaUserRepository.findByUserAndArenaStatusForUpdate(any(), any()))
                .thenReturn(Optional.empty());
    }

    // GROMO-673: 유저 태그는 이제 UserFocusTag(정체성=defaultTag). id 는 user_focus_tags.id, 이름은 defaultTag.name.
    private static UserFocusTag userFocusTag(UUID id, User user, String name) {
        return UserFocusTag.builder()
                .id(id)
                .user(user)
                .defaultTag(DefaultTag.builder().name(name).build())
                .build();
    }

    // ── getFocusTags ──────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 목록 조회 성공 → FocusTagResponse 리스트 매핑")
    void getFocusTagsSuccess() {
        // given: findById(USER_ID) → User, findByUser → 태그 2개
        User user = User.builder().id(USER_ID).build();
        UUID tagId2 = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
        UserFocusTag tag1 = userFocusTag(TAG_ID, user, "공부");
        UserFocusTag tag2 = userFocusTag(tagId2, user, "운동");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByUserAndDeletedAtIsNull(user)).willReturn(List.of(tag1, tag2));

        // when
        List<FocusTagResponse> result = focusService.getFocusTags(USER_ID);

        // then: 크기/순서/필드(tagId,name) 매핑 검증
        assertThat(result).hasSize(2);
        assertThat(result).extracting(FocusTagResponse::tagId).containsExactly(TAG_ID, tagId2);
        assertThat(result).extracting(FocusTagResponse::name).containsExactly("공부", "운동");
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getFocusTagsUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> focusService.getFocusTags(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── getDefaultTags (occupation 기본 태그) ──────────────────────────────

    @Test
    @DisplayName("기본 태그 조회(occupation 지정) → 유저 조회 없이 occupation/tags 매핑, sortOrder 포함")
    void getDefaultTagsWithParam() {
        // given: occupation 파라미터 지정 → 유저 조회 불필요
        given(occupationDefaultTagRepository.findByOccupationOrderBySortOrderAsc(Occupation.UNIVERSITY))
                .willReturn(List.of(
                        OccupationDefaultTag.builder().occupation(Occupation.UNIVERSITY)
                                .defaultTag(DefaultTag.builder().name("전공 공부").build()).sortOrder(0).build(),
                        OccupationDefaultTag.builder().occupation(Occupation.UNIVERSITY)
                                .defaultTag(DefaultTag.builder().name("과제").build()).sortOrder(1).build()));

        // when
        OccupationDefaultTagsResponse result = focusService.getDefaultTags(USER_ID, Occupation.UNIVERSITY);

        // then
        assertThat(result.occupation()).isEqualTo(Occupation.UNIVERSITY);
        assertThat(result.tags()).extracting("name").containsExactly("전공 공부", "과제");
        assertThat(result.tags()).extracting("sortOrder").containsExactly(0, 1);
        verify(userRepository, never()).findById(any());
    }

    @Test
    @DisplayName("기본 태그 조회(occupation 미지정) → 유저 저장 occupation 사용")
    void getDefaultTagsFallbackToUserOccupation() {
        // given: 파라미터 null → 유저의 저장 occupation(LABOR_ATTORNEY) 사용
        User user = User.builder().id(USER_ID).occupation(Occupation.LABOR_ATTORNEY).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(occupationDefaultTagRepository.findByOccupationOrderBySortOrderAsc(Occupation.LABOR_ATTORNEY))
                .willReturn(List.of(
                        OccupationDefaultTag.builder().occupation(Occupation.LABOR_ATTORNEY)
                                .defaultTag(DefaultTag.builder().name("민법").build()).sortOrder(0).build()));

        // when
        OccupationDefaultTagsResponse result = focusService.getDefaultTags(USER_ID, null);

        // then
        assertThat(result.occupation()).isEqualTo(Occupation.LABOR_ATTORNEY);
        assertThat(result.tags()).extracting("name").containsExactly("민법");
    }

    @Test
    @DisplayName("기본 태그 조회(미지정) — 유저 occupation 이 null → FocusException(OCCUPATION_REQUIRED)")
    void getDefaultTagsOccupationRequired() {
        // given: 파라미터 null + 유저 occupation 미설정(온보딩 미완료)
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when & then
        assertThatThrownBy(() -> focusService.getDefaultTags(USER_ID, null))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.OCCUPATION_REQUIRED);
    }

    @Test
    @DisplayName("기본 태그 조회(미지정) — 유저 없음 → UserException(NOT_FOUND)")
    void getDefaultTagsUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> focusService.getDefaultTags(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── setupFocusTag ─────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 생성 성공(신규 default_tag) → DefaultTag 생성 후 UserFocusTag 채택")
    void setupFocusTagSuccess() {
        // given: '공부' default_tag 미존재 → 새로 생성 후 UserFocusTag 채택
        User user = User.builder().id(USER_ID).build();
        DefaultTag defaultTag = DefaultTag.builder().name("공부").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(defaultTagRepository.findByName("공부")).willReturn(Optional.empty());
        given(defaultTagRepository.save(any(DefaultTag.class))).willReturn(defaultTag);
        given(userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(user, defaultTag))
                .willReturn(Optional.empty());
        given(userFocusTagRepository.save(any(UserFocusTag.class)))
                .willReturn(userFocusTag(TAG_ID, user, "공부"));
        FocusTagSetupRequest body = new FocusTagSetupRequest("공부");

        // when
        focusService.setupFocusTag(USER_ID, body);

        // then: default_tag 신규 생성 + UserFocusTag 채택(user/defaultTag) 검증
        ArgumentCaptor<DefaultTag> defaultCaptor = ArgumentCaptor.forClass(DefaultTag.class);
        verify(defaultTagRepository).save(defaultCaptor.capture());
        assertThat(defaultCaptor.getValue().getName()).isEqualTo("공부");
        ArgumentCaptor<UserFocusTag> captor = ArgumentCaptor.forClass(UserFocusTag.class);
        verify(userFocusTagRepository).save(captor.capture());
        assertThat(captor.getValue().getUser()).isEqualTo(user);
        assertThat(captor.getValue().getDefaultTag()).isEqualTo(defaultTag);
    }

    @Test
    @DisplayName("태그 생성(기존 default_tag 재사용) → default_tag 신규 저장 없이 UserFocusTag 채택")
    void setupFocusTagReusesExistingDefaultTag() {
        // given: '공부' default_tag 이미 존재 → 재사용, 새 UserFocusTag 채택
        User user = User.builder().id(USER_ID).build();
        DefaultTag existing = DefaultTag.builder().name("공부").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(defaultTagRepository.findByName("공부")).willReturn(Optional.of(existing));
        given(userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(user, existing))
                .willReturn(Optional.empty());
        given(userFocusTagRepository.save(any(UserFocusTag.class)))
                .willReturn(userFocusTag(TAG_ID, user, "공부"));

        // when
        focusService.setupFocusTag(USER_ID, new FocusTagSetupRequest("공부"));

        // then: default_tag 신규 저장 없음, UserFocusTag 는 기존 default_tag 참조
        verify(defaultTagRepository, never()).save(any(DefaultTag.class));
        ArgumentCaptor<UserFocusTag> captor = ArgumentCaptor.forClass(UserFocusTag.class);
        verify(userFocusTagRepository).save(captor.capture());
        assertThat(captor.getValue().getDefaultTag()).isEqualTo(existing);
    }

    @Test
    @DisplayName("태그 재채택(멱등) — 이미 활성 채택 중이면 새 UserFocusTag 저장하지 않음")
    void setupFocusTagIdempotentWhenAlreadyAdopted() {
        // given: '공부' default_tag 존재 + 유저가 이미 활성 채택 중
        User user = User.builder().id(USER_ID).build();
        DefaultTag existing = DefaultTag.builder().name("공부").build();
        UserFocusTag alreadyAdopted = userFocusTag(TAG_ID, user, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(defaultTagRepository.findByName("공부")).willReturn(Optional.of(existing));
        given(userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(user, existing))
                .willReturn(Optional.of(alreadyAdopted));

        // when
        focusService.setupFocusTag(USER_ID, new FocusTagSetupRequest("공부"));

        // then: 중복 채택 저장 없음, 이벤트는 기존 tag_id 로 발행
        verify(userFocusTagRepository, never()).save(any(UserFocusTag.class));
        verify(userActivityEventLogger).log(UserActivityEvent.FOCUS_TAG_CREATED,
                Map.of("tag_id", TAG_ID.toString()));
    }

    @Test
    @DisplayName("태그 생성 → FOCUS_TAG_CREATED(tag_id=user_focus_tags.id) 발행, 태그 이름은 PII 로 payload 제외")
    void setupFocusTagEmitsTagCreated() {
        // given: save 가 id 채워진 UserFocusTag 를 반환
        User user = User.builder().id(USER_ID).build();
        DefaultTag defaultTag = DefaultTag.builder().name("공부").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(defaultTagRepository.findByName("공부")).willReturn(Optional.of(defaultTag));
        given(userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(user, defaultTag))
                .willReturn(Optional.empty());
        given(userFocusTagRepository.save(any(UserFocusTag.class)))
                .willReturn(userFocusTag(TAG_ID, user, "공부"));

        // when
        focusService.setupFocusTag(USER_ID, new FocusTagSetupRequest("공부"));

        // then: tag_id 만 payload 에 포함(이름 미포함)
        verify(userActivityEventLogger).log(UserActivityEvent.FOCUS_TAG_CREATED,
                Map.of("tag_id", TAG_ID.toString()));
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void setupFocusTagUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusTagSetupRequest body = new FocusTagSetupRequest("공부");

        // when & then
        assertThatThrownBy(() -> focusService.setupFocusTag(USER_ID, body))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(userFocusTagRepository, never()).save(any(UserFocusTag.class));
    }

    // ── updateFocusTag ────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 수정 성공 → 기존 채택 소프트딜리트 + 새 이름 default_tag 로 재채택 (공유 default_tags 오염 방지)")
    void updateFocusTagSuccess() {
        // given: 소유자가 USER_ID 인 태그('이전이름'), 새 이름 '새이름' default_tag 는 신규
        User owner = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, owner, "이전이름");
        DefaultTag target = DefaultTag.builder().name("새이름").build();
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        given(defaultTagRepository.findByName("새이름")).willReturn(Optional.empty());
        given(defaultTagRepository.save(any(DefaultTag.class))).willReturn(target);
        given(userFocusTagRepository.findByUserAndDefaultTagAndDeletedAtIsNull(owner, target))
                .willReturn(Optional.empty());
        given(userFocusTagRepository.save(any(UserFocusTag.class))).willAnswer(inv -> inv.getArgument(0));
        FocusTagUpdateRequest body = new FocusTagUpdateRequest(TAG_ID, "새이름");

        // when
        focusService.updateFocusTag(USER_ID, body);

        // then: 기존 태그 소프트딜리트 + 새 이름 default_tag 로 재채택
        assertThat(tag.getDeletedAt()).isNotNull();
        ArgumentCaptor<UserFocusTag> captor = ArgumentCaptor.forClass(UserFocusTag.class);
        verify(userFocusTagRepository).save(captor.capture());
        assertThat(captor.getValue().getDefaultTag()).isEqualTo(target);
        assertThat(captor.getValue().getUser()).isEqualTo(owner);
    }

    @Test
    @DisplayName("태그 수정 — 같은 이름(같은 default_tag)이면 no-op (소프트딜리트/재채택 없음)")
    void updateFocusTagSameNameIsNoop() {
        // given: 기존 태그와 요청 이름이 동일한 default_tag
        User owner = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, owner, "공부");
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        given(defaultTagRepository.findByName("공부")).willReturn(Optional.of(tag.getDefaultTag()));
        FocusTagUpdateRequest body = new FocusTagUpdateRequest(TAG_ID, "공부");

        // when
        focusService.updateFocusTag(USER_ID, body);

        // then: 변경 없음 — 소프트딜리트/재채택 저장 없음
        assertThat(tag.getDeletedAt()).isNull();
        verify(userFocusTagRepository, never()).save(any(UserFocusTag.class));
    }

    @Test
    @DisplayName("존재하지 않는 태그 → FocusException(TAG_NOT_FOUND)")
    void updateFocusTagNotFound() {
        // given
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.empty());
        FocusTagUpdateRequest body = new FocusTagUpdateRequest(TAG_ID, "새이름");

        // when & then
        assertThatThrownBy(() -> focusService.updateFocusTag(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.TAG_NOT_FOUND);
    }

    @Test
    @DisplayName("다른 유저의 태그 → FocusException(FORBIDDEN)")
    void updateFocusTagForbidden() {
        // given: 태그 소유자가 OTHER_USER_ID
        User otherOwner = User.builder().id(OTHER_USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, otherOwner, "이전이름");
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusTagUpdateRequest body = new FocusTagUpdateRequest(TAG_ID, "새이름");

        // when & then: USER_ID 로 수정 시 FORBIDDEN
        assertThatThrownBy(() -> focusService.updateFocusTag(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
    }

    // ── deleteFocusTag ────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 삭제 성공 → 소프트 딜리트(deletedAt 세팅), 하드 delete 미호출")
    void deleteFocusTagSuccess() {
        // given: 소유자 USER_ID 태그
        User owner = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, owner, "공부");
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));

        // when
        focusService.deleteFocusTag(USER_ID, TAG_ID);

        // then: 하드 삭제가 아니라 deletedAt 세팅
        assertThat(tag.getDeletedAt()).isNotNull();
        verify(userFocusTagRepository, never()).delete(any(UserFocusTag.class));
    }

    @Test
    @DisplayName("존재하지 않는 태그 → FocusException(TAG_NOT_FOUND)")
    void deleteFocusTagNotFound() {
        // given
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> focusService.deleteFocusTag(USER_ID, TAG_ID))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.TAG_NOT_FOUND);
    }

    @Test
    @DisplayName("다른 유저의 태그 → FocusException(FORBIDDEN)")
    void deleteFocusTagForbidden() {
        // given: 소유자 OTHER_USER_ID
        User otherOwner = User.builder().id(OTHER_USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, otherOwner, "공부");
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));

        // when & then: FORBIDDEN, delete 미호출
        assertThatThrownBy(() -> focusService.deleteFocusTag(USER_ID, TAG_ID))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(userFocusTagRepository, never()).delete(any(UserFocusTag.class));
    }

    // ── getFocusSessions (커서 페이지네이션) ────────────────────────────────

    private static final Instant FROM = Instant.parse("2026-06-01T00:00:00Z");
    private static final Instant TO = Instant.parse("2026-06-30T23:59:59Z");
    private static final UUID LAST_ID = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

    @Test
    @DisplayName("커서 조회 성공 → 태그 null 포함 매핑 + hasNext/nextCursor(마지막 id)")
    void getFocusSessionsSuccess() {
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        FocusSession withTag = FocusSession.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000bb"))
                .user(user).focusTag(tag)
                .startedAt(START).endedAt(END)
                .totalDistractionSeconds(30).build();
        FocusSession withoutTag = FocusSession.builder()
                .id(LAST_ID)
                .user(user).focusTag(null)
                .startedAt(START).endedAt(END)
                .totalDistractionSeconds(0).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        // 첫 페이지(cursor=null) — id DESC 정렬 결과 2건, 다음 페이지 있음
        given(focusSessionRepository.findSessionsByCursor(
                eq(user), any(Instant.class), any(Instant.class), isNull(), any(Pageable.class)))
                .willReturn(new SliceImpl<>(List.of(withTag, withoutTag), PageRequest.of(0, 20), true));

        FocusSessionSliceResponse result = focusService.getFocusSessions(USER_ID, FROM, TO, null, 20);

        assertThat(result.content()).hasSize(2);
        assertThat(result.content().get(0).getFocusTagId()).isEqualTo(TAG_ID);
        assertThat(result.content().get(0).getTotalDistractionSeconds()).isEqualTo(30);
        assertThat(result.content().get(1).getFocusTagId()).isNull();
        assertThat(result.size()).isEqualTo(20);
        assertThat(result.hasNext()).isTrue();
        assertThat(result.nextCursor()).isEqualTo(LAST_ID); // 마지막(최소 id) 항목
    }

    @Test
    @DisplayName("마지막 페이지 → hasNext=false, nextCursor=null")
    void getFocusSessionsLastPage() {
        User user = User.builder().id(USER_ID).build();
        FocusSession only = FocusSession.builder()
                .id(LAST_ID).user(user)
                .startedAt(START).endedAt(END).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findSessionsByCursor(
                eq(user), any(Instant.class), any(Instant.class), isNull(), any(Pageable.class)))
                .willReturn(new SliceImpl<>(List.of(only), PageRequest.of(0, 20), false));

        FocusSessionSliceResponse result = focusService.getFocusSessions(USER_ID, FROM, TO, null, 20);

        assertThat(result.hasNext()).isFalse();
        assertThat(result.nextCursor()).isNull();
    }

    @Test
    @DisplayName("cursor 지정 시 리포지토리에 그대로 전달")
    void getFocusSessionsPassesCursor() {
        User user = User.builder().id(USER_ID).build();
        UUID cursor = UUID.fromString("00000000-0000-0000-0000-0000000000cc");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findSessionsByCursor(
                eq(user), any(Instant.class), any(Instant.class), eq(cursor), any(Pageable.class)))
                .willReturn(new SliceImpl<>(List.of(), PageRequest.of(0, 20), false));

        focusService.getFocusSessions(USER_ID, FROM, TO, cursor, 20);

        verify(focusSessionRepository)
                .findSessionsByCursor(eq(user), any(Instant.class), any(Instant.class), eq(cursor), any(Pageable.class));
    }

    @Test
    @DisplayName("from > to → FocusException(INVALID_DATE_RANGE), 리포지토리 미조회")
    void getFocusSessionsInvalidDateRange() {
        assertThatThrownBy(() -> focusService.getFocusSessions(USER_ID, TO, FROM, null, 20))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.INVALID_DATE_RANGE);
        verify(focusSessionRepository, never())
                .findSessionsByCursor(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("size 범위 밖(0, 101) → FocusException(INVALID_PAGE_REQUEST)")
    void getFocusSessionsInvalidSize() {
        assertThatThrownBy(() -> focusService.getFocusSessions(USER_ID, FROM, TO, null, 0))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.INVALID_PAGE_REQUEST);
        assertThatThrownBy(() -> focusService.getFocusSessions(USER_ID, FROM, TO, null, 101))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.INVALID_PAGE_REQUEST);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getFocusSessionsUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> focusService.getFocusSessions(USER_ID, FROM, TO, null, 20))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── saveFocusSession ──────────────────────────────────────────────────

    @Test
    @DisplayName("세션 저장 성공(태그 포함) → FocusSession 저장")
    void saveFocusSessionSuccess() {
        // given: 유효한 시간 + 본인 소유 태그
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        // DailyFocusStat upsert 경로 설정 (신규 insert)
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, START, END, 30);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then: 저장 값 검증
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        FocusSession saved = captor.getValue();
        assertThat(saved.getUser()).isEqualTo(user);
        assertThat(saved.getFocusTag()).isEqualTo(tag);
        assertThat(saved.getStartedAt()).isEqualTo(START);
        assertThat(saved.getEndedAt()).isEqualTo(END);
        assertThat(saved.getTotalDistractionSeconds()).isEqualTo(30);
    }

    // ── GROMO-646: 세션 완료 시 리그 공부시간 반영 ──────────────────────────

    @Test
    @DisplayName("GROMO-665: 세션 완료 시 ACTIVE 아레나 멤버면 리그 공부시간 += (초 직접 누적, 분 내림 없음)")
    void recordCompletionAddsFocusSecondsToActiveArena() {
        // given: 기존 10초 누적된 ACTIVE 아레나 멤버 + 60분(3600초) 세션
        User user = User.builder().id(USER_ID).build();
        LeagueArenaUser member = LeagueArenaUser.builder().user(user).totalFocusSeconds(10).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(leagueArenaUserRepository.findByUserAndArenaStatusForUpdate(eq(USER_ID), eq(LeagueArenaStatus.ACTIVE)))
                .willReturn(Optional.of(member));
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when: START~END = 60분
        focusService.saveFocusSession(USER_ID, body);

        // then: 10 + 3600 = 3610 초 (초 직접 누적, 분 내림 없음 — 더티 체킹 반영)
        assertThat(member.getTotalFocusSeconds()).isEqualTo(3610);
    }

    @Test
    @DisplayName("GROMO-646: 세션 완료 시 ACTIVE 아레나 없으면 리그 미갱신(스킵, 예외 없음)")
    void recordCompletionSkipsLeagueWhenNoActiveArena() {
        // given: 아레나 미배정(@BeforeEach 기본 empty)
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when & then: 예외 없이 완료 (리그 조회는 하되 empty → 스킵)
        focusService.saveFocusSession(USER_ID, body);
        verify(leagueArenaUserRepository).findByUserAndArenaStatusForUpdate(USER_ID, LeagueArenaStatus.ACTIVE);
    }

    @Test
    @DisplayName("태그 없이 세션 저장 성공 → focusTag = null 로 저장")
    void saveFocusSessionWithoutTag() {
        // given: focusTagId == null
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        // DailyFocusStat upsert 경로 설정 (신규 insert)
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then: 저장된 세션의 focusTag 가 null
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getFocusTag()).isNull();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void saveFocusSessionUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    @Test
    @DisplayName("시작/종료 시간 누락 → IllegalArgumentException")
    void saveFocusSessionNullTime() {
        // given: 유저는 존재하지만 startedAt/endedAt 이 null
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        FocusSessionRequest body = new FocusSessionRequest(null, null, null, 0);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(IllegalArgumentException.class);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    @Test
    @DisplayName("종료 시간이 시작보다 앞섬 → IllegalArgumentException")
    void saveFocusSessionEndBeforeStart() {
        // given: endedAt < startedAt
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        FocusSessionRequest body = new FocusSessionRequest(null, END, START, 0);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(IllegalArgumentException.class);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    @Test
    @DisplayName("다른 유저의 태그로 세션 저장 → FocusException(FORBIDDEN)")
    void saveFocusSessionForbiddenTag() {
        // given: focusTagId 의 태그 소유자가 OTHER_USER_ID
        User user = User.builder().id(USER_ID).build();
        User other = User.builder().id(OTHER_USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, other, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, START, END, 30);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    // ── saveFocusSession — 이벤트 payload·스트릭 연동 (GROMO-395) ──────────

    @Test
    @DisplayName("태그 있는 세션 저장 → FOCUS_SESSION_COMPLETED payload 에 focus_tag_id 포함")
    void saveFocusSessionLogsWithFocusTagId() {
        // given: START~END = 3600초, 본인 소유 태그
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, START, END, 30);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then
        verify(userActivityEventLogger).log(UserActivityEvent.FOCUS_SESSION_COMPLETED,
                Map.of("duration_seconds", 3600L,
                        "total_distraction_seconds", 30,
                        "has_tag", true,
                        "focus_tag_id", TAG_ID.toString()));
    }

    @Test
    @DisplayName("태그 없는 세션 저장 → payload 에 focus_tag_id 키 생략(null 값 금지)")
    void saveFocusSessionLogsWithoutFocusTagId() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then: focus_tag_id 키 자체가 없음
        verify(userActivityEventLogger).log(UserActivityEvent.FOCUS_SESSION_COMPLETED,
                Map.of("duration_seconds", 3600L,
                        "total_distraction_seconds", 0,
                        "has_tag", false));
    }

    @Test
    @DisplayName("세션 저장(countryCode=null) → 스트릭 갱신을 endedAt UTC 폴백 날짜로 호출(같은 트랜잭션, GROMO-803)")
    void saveFocusSessionUpdatesStreakWithUtcDate() {
        // given: countryCode 없는 유저 → UTC 폴백. 2026-06-22 23:55Z 시작 → 2026-06-23 00:05Z 종료
        //        → endedAt 의 UTC 날짜(23일)로 호출돼야 함(존 미지정 폴백 케이스). KR 존 케이스는 T3-KST 참고.
        Instant startedAt = Instant.parse("2026-06-22T23:55:00Z");
        Instant endedAt = Instant.parse("2026-06-23T00:05:00Z");
        User user = User.builder().id(USER_ID).build();   // countryCode 미설정 → UTC 폴백
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, startedAt, endedAt, 0);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then
        verify(userStreakService).updateOnSessionComplete(user, LocalDate.of(2026, 6, 23));
    }

    @Test
    @DisplayName("세션 저장 실패(태그 FORBIDDEN) → 스트릭 갱신 미호출")
    void saveFocusSessionFailureDoesNotUpdateStreak() {
        // given: 다른 유저 소유 태그
        User user = User.builder().id(USER_ID).build();
        User other = User.builder().id(OTHER_USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, other, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, START, END, 30);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class);
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    // ── DailyFocusStat upsert (T1-T7) ────────────────────────────────────

    /** T1: 신규 날짜 첫 세션 → DailyFocusStat 신규 insert, 집계 정합 검증 */
    @Test
    @DisplayName("T1: 신규 날짜 첫 세션 → DailyFocusStat 신규 insert, totalFocusMinutes/sessionCount/totalDistractionSeconds 정합")
    void saveFocusStat_newDate_firstSession_createsNewRow() {
        // START=01:00Z, END=02:00Z → 60분, endedAt UTC date = 2026-06-23
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 30);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        DailyFocusStat stat = captor.getValue();
        assertThat(stat.getTotalFocusSeconds()).isEqualTo(60 * 60);
        assertThat(stat.getSessionCount()).isEqualTo(1);
        assertThat(stat.getTotalDistractionSeconds()).isEqualTo(30);
        assertThat(stat.isFocusTimeGoalAchieved()).isFalse();
    }

    /** T2: 같은 날 두 번째 세션 → 기존 row 누적(totalFocusMinutes 합산, sessionCount+1, totalDistractionSeconds 합산) */
    @Test
    @DisplayName("T2: 같은 날 두 번째 세션 → 기존 row 누적 — totalFocusMinutes/sessionCount/totalDistractionSeconds 합산")
    void saveFocusStat_sameDay_secondSession_accumulates() {
        // 기존 30분·1세션·방해 1초 row 존재, 60분·방해 0초 세션 추가 → 90분·2세션·방해 1초
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusSeconds(30 * 60).sessionCount(1).totalDistractionSeconds(1).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 업데이트 경로: save() 미호출(더티 체킹), 필드 누적 검증
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        assertThat(existing.getTotalFocusSeconds()).isEqualTo(90 * 60);
        assertThat(existing.getSessionCount()).isEqualTo(2);
        assertThat(existing.getTotalDistractionSeconds()).isEqualTo(1);
    }

    /**
     * T3 (GROMO-803): 집계 날짜는 유저 country_code 파생 존 로컬 날짜로 버킷팅된다.
     * 이 케이스는 {@code countryCode==null} 유저 → UTC 폴백(CountryZoneResolver)이라 endedAt 의 UTC date 로 귀속.
     * 시나리오: endedAt = 07-06 23:00Z, 유저 존 없음 → UTC → 07-06 로 귀속.
     * (KR 유저의 존 전환 확증은 saveFocusStat_krUser_bucketsByKstDate 참고.)
     */
    @Test
    @DisplayName("T3(GROMO-803): countryCode=null 유저 → UTC 폴백으로 endedAt UTC date 에 귀속")
    void saveFocusStat_nullCountry_bucketsByUtcDate() {
        Instant startedAt = Instant.parse("2026-07-06T22:30:00Z");
        Instant endedAt = Instant.parse("2026-07-06T23:00:00Z");   // 존 없음 → UTC date = 07-06
        LocalDate endedAtUtcDate = LocalDate.of(2026, 7, 6);

        User user = User.builder().id(USER_ID).build();   // countryCode 미설정 → UTC 폴백
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(endedAtUtcDate)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, startedAt, endedAt, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 존 없음 → UTC date(07-06)로 귀속
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(endedAtUtcDate);
    }

    /**
     * T3-KST (GROMO-803/720): KR 유저의 세션은 country_code(KR) 존(KST)의 로컬 날짜로 버킷팅된다.
     * 시나리오: endedAt = 2026-07-12T20:00:00Z = 2026-07-13 05:00 KST → statDate 2026-07-13.
     * 과거 UTC 기준이었다면 07-12 로 귀속됐을 것 — 존 전환을 확증한다(집계 존 == screentime 존).
     */
    @Test
    @DisplayName("T3-KST(GROMO-803): KR 유저 endedAt 20:00Z(=05:00 KST 익일) → statDate=07-13 (UTC였다면 07-12)")
    void saveFocusStat_krUser_bucketsByKstDate() {
        Instant startedAt = Instant.parse("2026-07-12T19:30:00Z");
        Instant endedAt = Instant.parse("2026-07-12T20:00:00Z");   // = 2026-07-13 05:00 KST
        LocalDate kstDate = LocalDate.of(2026, 7, 13);
        LocalDate utcDate = LocalDate.of(2026, 7, 12);

        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(krUser), eq(kstDate)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, startedAt, endedAt, 0);

        focusService.saveFocusSession(USER_ID, body);

        // KST 로컬 날짜(07-13)로 귀속 — UTC(07-12)가 아님
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
        assertThat(captor.getValue().getDate()).isNotEqualTo(utcDate);
        // 집계 존 == 스트릭 존 — 같은 statDate(07-13)로 스트릭 갱신되어야 한다(경계 세션이 오늘 스트릭에 반영)
        verify(userStreakService).updateOnSessionComplete(krUser, kstDate);
    }

    /**
     * T3-574 (GROMO-574): 집중 저장 존 == 스크린타임 저장 존 (같은 유저·같은 country_code 존).
     * ScreenTimeService.resolveLocalDate 는 {@code reportedAt.atZone(CountryZoneResolver.resolve(countryCode))},
     * FocusService.statDate 는 {@code endedAt.atZone(CountryZoneResolver.resolve(countryCode))} — 동일 규칙이다.
     * 동일 유저(KR)·동일 순간(instant)을 두 도메인에 넣으면 같은 날짜에 귀속됨을 확인한다(도메인 정합).
     * 여행/국가변경(디바이스 존 ≠ country 존) 엣지는 stats package-info 문서로 수용(코드 미처리).
     */
    @Test
    @DisplayName("T3-574: 집중 저장 존 == 스크린타임 저장 존 — 같은 유저·같은 순간이 같은 날짜에 귀속(country_code 존)")
    void saveFocusStat_zoneMatchesScreenTimeZone() {
        // 경계 순간: 2026-07-12T20:00:00Z = 2026-07-13 05:00 KST (자정 넘김)
        Instant instant = Instant.parse("2026-07-12T20:00:00Z");
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();

        // 스크린타임이 같은 유저·같은 순간을 귀속시킬 날짜 = CountryZoneResolver 로 계산(도메인 공통 규칙)
        LocalDate screenTimeDate = instant.atZone(CountryZoneResolver.resolve(krUser.getCountryCode()))
                .toLocalDate();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        // startedAt 은 버킷에 영향 없음(endedAt 기준) — endedAt = 경계 순간
        FocusSessionRequest body = new FocusSessionRequest(null, instant.minusSeconds(1800), instant, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        // 집중 저장 날짜 == 스크린타임 저장 날짜 (둘 다 KST 07-13)
        assertThat(captor.getValue().getDate()).isEqualTo(screenTimeDate);
        assertThat(captor.getValue().getDate()).isEqualTo(LocalDate.of(2026, 7, 13));
    }

    /**
     * T3b (GROMO-642 회귀): 1분 미만 세션도 초로 누적돼 0 으로 사라지지 않는다.
     * 30초 세션 2건 → 60초(=응답 1분). 과거 버그(세션별 분 내림)에선 0+0=0 이었다.
     */
    @Test
    @DisplayName("T3b(GROMO-642): 30초 세션 2건 → 60초 누적 (분 내림 손실 회귀)")
    void saveFocusStat_subMinuteSessions_accumulateInSeconds() {
        Instant s1Start = Instant.parse("2026-07-07T01:00:00Z");
        Instant s1End = Instant.parse("2026-07-07T01:00:30Z");   // 30초
        LocalDate date = LocalDate.of(2026, 7, 7);
        User user = User.builder().id(USER_ID).build();

        // 1건째: 신규 insert → 30초 (과거엔 0분)
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(date)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        focusService.saveFocusSession(USER_ID,
                new FocusSessionRequest(null, s1Start, s1End, 0));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        DailyFocusStat inserted = captor.getValue();
        assertThat(inserted.getTotalFocusSeconds()).isEqualTo(30);   // 과거 버그: 0

        // 2건째: 같은 날 기존 row(30초)에 30초 더 → 60초 (과거엔 0+0=0)
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(date)))
                .willReturn(Optional.of(inserted));
        focusService.saveFocusSession(USER_ID,
                new FocusSessionRequest(null, s1Start, s1End, 0));

        assertThat(inserted.getTotalFocusSeconds()).isEqualTo(60);
    }

    /** T4: 목표 달성 플래그 — 누적 후 goal 이상이면 focusGoalAchieved=true (경계: ==goal) */
    @Test
    @DisplayName("T4: 누적 totalFocusMinutes >= goal → focusGoalAchieved=true (경계값 ==goal)")
    void saveFocusStat_afterAccumulation_achievesGoal_setsFlagTrue() {
        // START=01:00Z, END=02:00Z → 60분 세션, goal=60 → 60>=60 → 달성
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalFocusSeconds()).isEqualTo(60 * 60);
        assertThat(captor.getValue().isFocusTimeGoalAchieved()).isTrue();
    }

    /** T5: UserFocusTimeSettings row 없음(목표 미설정) → 예외 없이 정상 완료, focusGoalAchieved=false 유지 */
    @Test
    @DisplayName("T5: UserFocusTimeSettings row 없음 → 예외 없음, focusGoalAchieved=false 유지")
    void saveFocusStat_noSettingsRow_skipsFlagSetting() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        // 목표 설정 row 없음
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isFocusTimeGoalAchieved()).isFalse();
    }

    /** T6: dailyFocusTimeGoalMinutes=0 → 플래그 세팅 스킵, focusGoalAchieved=false */
    @Test
    @DisplayName("T6: goal=0 설정 → 달성 플래그 세팅 스킵, focusGoalAchieved=false")
    void saveFocusStat_goalIsZero_skipsFlagSetting() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        // goal=0 설정
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(0).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isFocusTimeGoalAchieved()).isFalse();
    }

    /** T7: 방해 초 누적 — 두 세션의 totalDistractionSeconds 합산 정합 검증 */
    @Test
    @DisplayName("T7: 기존 row에 두 번째 세션 totalDistractionSeconds 누적 → 합산 정합")
    void saveFocusStat_totalDistractionSecondsAccumulates() {
        // 기존 방해 5초 row 존재 + 방해 3초 세션 추가 → 8초
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusSeconds(30 * 60).sessionCount(1).totalDistractionSeconds(5).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 3);

        focusService.saveFocusSession(USER_ID, body);

        assertThat(existing.getTotalDistractionSeconds()).isEqualTo(8); // 5 + 3
    }

    /** T8: update 경로 goal 달성 — 기존 30분·focusGoalAchieved=false·goal=60 에서 추가 30분 → 누적 60분 == goal → focusGoalAchieved=true 전이 */
    @Test
    @DisplayName("T8: update 경로 — 기존 30분(미달성) + 30분 세션 = 60분 누적 → focusGoalAchieved=true 전이")
    void saveFocusStat_updatePath_goalAchieved_setsFlagTrue() {
        // 기존 row: 30분·1세션·미달성(false), goal=60
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusSeconds(30 * 60).sessionCount(1).totalDistractionSeconds(0)
                .isFocusTimeGoalAchieved(false).build();
        // 추가 세션: START=01:00Z ~ 01:30Z → 30분
        Instant end30 = Instant.parse("2026-06-23T01:30:00Z");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));
        FocusSessionRequest body = new FocusSessionRequest(null, START, end30, 0);

        focusService.saveFocusSession(USER_ID, body);

        // update 경로: save() 미호출, 누적 60분 == goal → focusGoalAchieved=true 전이
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        assertThat(existing.getTotalFocusSeconds()).isEqualTo(60 * 60);
        assertThat(existing.isFocusTimeGoalAchieved()).isTrue();
    }

    /** T9: update 경로 이미 달성(true) → userFocusTimeSettingsRepository 조회 스킵(단방향 플래그) */
    @Test
    @DisplayName("T9: update 경로 — focusGoalAchieved=true 이미 달성 시 goal 조회 없이 스킵")
    void saveFocusStat_updatePath_alreadyAchieved_skipsGoalQuery() {
        // 기존 row: 이미 달성(true) — 추가 세션이 와도 재판정 불필요
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusSeconds(60 * 60).sessionCount(1).totalDistractionSeconds(0)
                .isFocusTimeGoalAchieved(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 달성 상태 그대로 유지, goal 조회를 위한 findById 미호출
        assertThat(existing.isFocusTimeGoalAchieved()).isTrue();
        verify(userFocusTimeSettingsRepository, never()).findById(any());
    }

    // ── 스트릭 10분 게이트 + 세션완료 응답 필드 (GROMO-806) ──────────────────

    /** ① 그날 누적 10분 미만 → updateOnSessionComplete 미호출(스트릭 미인정). */
    @Test
    @DisplayName("806-①: 그날 누적 < 10분(신규 5분) → 스트릭 갱신 미호출, streakQualifiedToday=false")
    void streakGate_belowThreshold_doesNotUpdateStreak() {
        // 신규 row, 5분(300초) 세션 → dayTotal=300 < 600 → 스트릭 미갱신
        Instant end5m = Instant.parse("2026-06-23T01:05:00Z");   // START=01:00 → 5분
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, end5m, 0));

        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(300);
        assertThat(response.streakQualifiedToday()).isFalse();
    }

    /** ② 두 세션 합산으로 10분 도달 → 2번째 세션에서 스트릭 갱신(1번째는 미갱신). */
    @Test
    @DisplayName("806-②: 5분+6분 → 1회차 미갱신, 2회차 누적 11분 → 스트릭 갱신")
    void streakGate_twoSessionsReachThreshold_updatesOnSecond() {
        LocalDate date = LocalDate.of(2026, 6, 23);
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        // 1회차: 신규 row 5분(300초) → dayTotal=300 < 600 → 미갱신
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(date)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        Instant end5m = Instant.parse("2026-06-23T01:05:00Z");
        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, end5m, 0));
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());

        // 2회차: 기존 row(300초)에 6분(360초) 추가 → dayTotal=660 >= 600 → 갱신
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(date).totalFocusSeconds(300).sessionCount(1).totalDistractionSeconds(0).build();
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(date)))
                .willReturn(Optional.of(existing));
        Instant start2 = Instant.parse("2026-06-23T02:00:00Z");
        Instant end6m = Instant.parse("2026-06-23T02:06:00Z");   // START2=02:00 → 6분
        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, start2, end6m, 0));

        verify(userStreakService).updateOnSessionComplete(user, date);
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(660);
        assertThat(response.streakQualifiedToday()).isTrue();
    }

    /** ③ 이미 10분 넘긴 뒤 추가 세션 → 스트릭 재호출(기존 same-day 멱등이 무변화 보장). */
    @Test
    @DisplayName("806-③: 이미 10분 초과한 날 추가 세션 → 스트릭 재호출(멱등은 UserStreakService 책임)")
    void streakGate_alreadyQualified_stillCallsStreak() {
        LocalDate date = LocalDate.of(2026, 6, 23);
        User user = User.builder().id(USER_ID).build();
        // 기존 누적 30분(1800초) → 이미 인정된 날. 추가 60분 세션 → dayTotal=90분 >= 600 → 재호출.
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(date).totalFocusSeconds(30 * 60).sessionCount(1).totalDistractionSeconds(0).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(date)))
                .willReturn(Optional.of(existing));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 0));

        // 게이트 통과(누적>=600) → 호출됨. "이미 인정된 날 무변화"는 UserStreakService.same-day 멱등이 담당.
        verify(userStreakService).updateOnSessionComplete(user, date);
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(90 * 60);
        assertThat(response.streakQualifiedToday()).isTrue();
    }

    /** 경계: 정확히 10분(600초) → 인정(>=). */
    @Test
    @DisplayName("806 경계: 정확히 10분(600초) → 스트릭 갱신(>= 경계 포함)")
    void streakGate_exactlyTenMinutes_updatesStreak() {
        // 23:55Z ~ 00:05Z = 600초 정확
        Instant startedAt = Instant.parse("2026-06-22T23:55:00Z");
        Instant endedAt = Instant.parse("2026-06-23T00:05:00Z");
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        verify(userStreakService).updateOnSessionComplete(user, LocalDate.of(2026, 6, 23));
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(600);
        assertThat(response.streakQualifiedToday()).isTrue();
    }

    /** ④ PATCH 종료 응답에도 dayTotalFocusSeconds·streakQualifiedToday 채워짐(미달 케이스). */
    @Test
    @DisplayName("806-④: PATCH 종료 응답 — 5분 미달 → dayTotalFocusSeconds=300, streakQualifiedToday=false")
    void endFocusSession_responseHasStreakFields_belowThreshold() {
        User user = User.builder().id(USER_ID).build();
        Instant end5m = Instant.parse("2026-06-23T01:05:00Z");   // START=01:00 → 5분
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, end5m)).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionEndResponse response =
                focusService.endFocusSession(USER_ID, new FocusSessionEndRequest(SESSION_ID, end5m, 0, null));

        assertThat(response.dayTotalFocusSeconds()).isEqualTo(300);
        assertThat(response.streakQualifiedToday()).isFalse();
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    // ── DAILY_FOCUS_GOAL_ACHIEVED 이벤트 (GROMO-395 커밋 4) ─────────────────

    /** E1: insert 경로 — 신규 row 가 곧바로 달성(false→true 전이와 동일) → 이벤트 1회 발행 */
    @Test
    @DisplayName("E1: 첫 세션으로 목표 도달(insert 경로) → DAILY_FOCUS_GOAL_ACHIEVED 1회 발행")
    void saveFocusStat_insertPath_goalAchieved_emitsEvent() {
        // goal=60, START~END = 60분 세션 → 신규 row 즉시 달성
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 0));

        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED,
                Map.of("date", "2026-06-23", "total_focus_minutes", 60, "goal_minutes", 60));
    }

    /** E2: update 경로 — 누적으로 false→true 전이 → 이벤트 1회 발행 */
    @Test
    @DisplayName("E2: 누적으로 목표 도달(update 경로 false→true 전이) → DAILY_FOCUS_GOAL_ACHIEVED 1회 발행")
    void saveFocusStat_updatePath_transition_emitsEvent() {
        // 기존 30분 미달성 + 30분 세션 = 60분 == goal → 전이 발행
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusSeconds(30 * 60).sessionCount(1).totalDistractionSeconds(0)
                .isFocusTimeGoalAchieved(false).build();
        Instant end30 = Instant.parse("2026-06-23T01:30:00Z");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, end30, 0));

        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED,
                Map.of("date", "2026-06-23", "total_focus_minutes", 60, "goal_minutes", 60));
    }

    /** E3: 목표 미달 → 미발행 */
    @Test
    @DisplayName("E3: 목표 미달 → DAILY_FOCUS_GOAL_ACHIEVED 미발행")
    void saveFocusStat_goalNotReached_doesNotEmit() {
        // goal=120, 60분 세션 → 미달
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(120).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 0));

        verify(userActivityEventLogger, never())
                .log(eq(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED), anyMap());
    }

    /** E4: 이미 달성된 날 추가 세션(true 유지) → 재발행 없음 */
    @Test
    @DisplayName("E4: 이미 달성된 날 추가 세션(true→true) → DAILY_FOCUS_GOAL_ACHIEVED 재발행 없음")
    void saveFocusStat_alreadyAchieved_doesNotReEmit() {
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusSeconds(60 * 60).sessionCount(1).totalDistractionSeconds(0)
                .isFocusTimeGoalAchieved(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 0));

        verify(userActivityEventLogger, never())
                .log(eq(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED), anyMap());
    }

    /** E5: goal=0(판정 스킵) → 미발행 */
    @Test
    @DisplayName("E5: goal=0 → DAILY_FOCUS_GOAL_ACHIEVED 미발행")
    void saveFocusStat_goalZero_doesNotEmit() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(0).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 0));

        verify(userActivityEventLogger, never())
                .log(eq(UserActivityEvent.DAILY_FOCUS_GOAL_ACHIEVED), anyMap());
    }

    // ── startFocusSession — 라이브 세션 시작(GROMO-610) ──────────────────────

    @Test
    @DisplayName("라이브 세션 시작 성공 → endedAt null 로 저장, 생성 id 반환")
    void startFocusSessionSuccess() {
        // given
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        given(focusSessionRepository.save(any(FocusSession.class)))
                .willAnswer(inv -> FocusSession.builder()
                        .id(sessionId)
                        .user(user)
                        .focusTag(tag)
                        .startedAt(START)
                        .build());
        FocusSessionStartRequest body = new FocusSessionStartRequest(TAG_ID, START);

        // when
        FocusSessionStartResponse response = focusService.startFocusSession(USER_ID, body);

        // then: 저장된 세션은 endedAt null(진행 중), 응답에 생성 id·startedAt
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getEndedAt()).isNull();
        assertThat(captor.getValue().getStartedAt()).isEqualTo(START);
        assertThat(response.sessionId()).isEqualTo(sessionId);
        assertThat(response.startedAt()).isEqualTo(START);
        // 시작 시엔 통계·스트릭 미반영
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("startedAt 미지정 → 서버 시각(now) 사용, 세션 저장")
    void startFocusSessionDefaultsStartedAt() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        FocusSessionStartRequest body = new FocusSessionStartRequest(null, null);

        // when
        Instant before = Instant.now();
        focusService.startFocusSession(USER_ID, body);

        // then: startedAt 이 now 근처로 채워짐
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getStartedAt()).isAfterOrEqualTo(before);
        assertThat(captor.getValue().getEndedAt()).isNull();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void startFocusSessionUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionStartRequest body = new FocusSessionStartRequest(null, START);

        // when & then
        assertThatThrownBy(() -> focusService.startFocusSession(USER_ID, body))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    @Test
    @DisplayName("타인 태그로 시작 → FocusException(FORBIDDEN)")
    void startFocusSessionForbiddenTag() {
        // given
        User user = User.builder().id(USER_ID).build();
        User other = User.builder().id(OTHER_USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, other, "공부");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusSessionStartRequest body = new FocusSessionStartRequest(TAG_ID, START);

        // when & then
        assertThatThrownBy(() -> focusService.startFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    // ── endFocusSession — 라이브 세션 종료(GROMO-610) ────────────────────────

    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-0000000000f1");

    @Test
    @DisplayName("라이브 세션 종료 성공 → endedAt 채움 + 통계·스트릭 귀속, 요약 반환")
    void endFocusSessionSuccess() {
        // given: 본인 소유 진행 중 세션
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, END)).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, END, 30, null);

        // when
        FocusSessionEndResponse response = focusService.endFocusSession(USER_ID, body);

        // then: 세션에 endedAt·방해지표 반영(더티 체킹)
        assertThat(session.getEndedAt()).isEqualTo(END);
        assertThat(session.getTotalDistractionSeconds()).isEqualTo(30);
        // 완료 귀속(통계·스트릭·이벤트)
        verify(dailyFocusStatRepository).save(any(DailyFocusStat.class));
        verify(userStreakService).updateOnSessionComplete(eq(user), any());
        verify(userActivityEventLogger).log(eq(UserActivityEvent.FOCUS_SESSION_COMPLETED), anyMap());
        // 응답 요약: 1시간 = 3600초
        assertThat(response.sessionId()).isEqualTo(SESSION_ID);
        assertThat(response.durationSeconds()).isEqualTo(3600L);
        assertThat(response.totalDistractionSeconds()).isEqualTo(30);
    }

    /**
     * T3-KST-END (GROMO-803): 라이브 PATCH 종료도 country_code(KR) 존(KST) 로컬 날짜로 버킷팅된다.
     * saveFocusSession 의 saveFocusStat_krUser_bucketsByKstDate 를 endFocusSession 경로로 미러링한다.
     * 시나리오: endedAt = 2026-07-12T20:00:00Z = 2026-07-13 05:00 KST → statDate 2026-07-13.
     * 과거 UTC 기준이었다면 07-12 로 귀속됐을 것 — 종료 경로의 존 전환을 확증한다.
     * (기존 종료 테스트는 스트릭 날짜를 any() 로만 검증했다 — 여기선 eq(07-13) 로 못 박는다.)
     */
    @Test
    @DisplayName("T3-KST-END(GROMO-803): KR 유저 라이브 종료 endedAt 20:00Z(=05:00 KST 익일) → statDate=07-13 (UTC였다면 07-12)")
    void endFocusSession_krUser_bucketsByKstDate() {
        Instant startedAt = Instant.parse("2026-07-12T19:30:00Z");
        Instant endedAt = Instant.parse("2026-07-12T20:00:00Z");   // = 2026-07-13 05:00 KST
        LocalDate kstDate = LocalDate.of(2026, 7, 13);
        LocalDate utcDate = LocalDate.of(2026, 7, 12);

        // given: KR 유저의 본인 소유 진행 중(ACTIVE) 세션 + 조건부 종료 성사(row=1)
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(krUser).startedAt(startedAt).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(krUser));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);
        // 버킷 조회는 KST 날짜(07-13)로 이뤄져야 한다 — 신규 insert 경로
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(krUser), eq(kstDate)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, endedAt, 0, null);

        // when
        focusService.endFocusSession(USER_ID, body);

        // then: DailyFocusStat 은 KST 로컬 날짜(07-13)로 버킷팅 — UTC(07-12)가 아님
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
        assertThat(captor.getValue().getDate()).isNotEqualTo(utcDate);
        // 스트릭도 같은 statDate(07-13)로 갱신 — any() 가 아니라 eq(07-13) 로 확증
        verify(userStreakService).updateOnSessionComplete(eq(krUser), eq(kstDate));
    }

    @Test
    @DisplayName("endedAt 미지정 → 서버 시각(now)으로 종료")
    void endFocusSessionDefaultsEndedAt() {
        // given
        User user = User.builder().id(USER_ID).build();
        Instant recentStart = Instant.now().minusSeconds(60);
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(recentStart).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, null, 0, null);

        // when
        Instant before = Instant.now();
        focusService.endFocusSession(USER_ID, body);

        // then: endedAt 이 now 근처로 채워짐
        assertThat(session.getEndedAt()).isAfterOrEqualTo(before);
    }

    @Test
    @DisplayName("존재하지 않는 세션 → FocusException(SESSION_NOT_FOUND)")
    void endFocusSessionNotFound() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, END, 0, null);

        // when & then
        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_NOT_FOUND);
    }

    @Test
    @DisplayName("타인 세션 종료 → FocusException(FORBIDDEN)")
    void endFocusSessionForbidden() {
        // given: 세션 소유자가 OTHER_USER_ID
        User user = User.builder().id(USER_ID).build();
        User other = User.builder().id(OTHER_USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(other).startedAt(START).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, END, 0, null);

        // when & then
        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("이미 종료된 세션 재종료 → 조건부 UPDATE row=0 → FocusException(SESSION_ALREADY_ENDED)")
    void endFocusSessionAlreadyEnded() {
        // given: 조건부 종료 UPDATE 가 0행(endedAt IS NULL 아님 = 이미 종료됨)
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).endedAt(END).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(0);
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, END, 0, null);

        // when & then
        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_ALREADY_ENDED);
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("동시/중복 PATCH — 조건부 종료 패배(row=0) 시 통계·스트릭·이벤트 미반영(멱등)")
    void endFocusSessionConcurrentDuplicateIsIdempotent() {
        // given: 본인 진행 중 세션을 읽었으나, findById~UPDATE 사이 다른 요청이 먼저 종료해 조건부 UPDATE 가 0행
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(0);
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, END, 30, null);

        // when & then: 종료를 성사시키지 못한 요청은 recordCompletion(통계·스트릭·완료 이벤트)을 절대 실행하지 않는다
        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_ALREADY_ENDED);
        verify(dailyFocusStatRepository, never()).findByUserAndDateForUpdate(any(), any());
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        verify(userActivityEventLogger, never()).log(eq(UserActivityEvent.FOCUS_SESSION_COMPLETED), anyMap());
    }

    @Test
    @DisplayName("endedAt < startedAt → FocusException(INVALID_DATE_RANGE)")
    void endFocusSessionInvalidDateRange() {
        // given: endedAt(START) 이 startedAt(END) 보다 앞섬
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(END).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, START, 0, null);

        // when & then
        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.INVALID_DATE_RANGE);
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("종료 시 focusTagId 지정 → 태그 보정(applyTag)")
    void endFocusSessionAppliesTag() {
        // given: 시작 시 태그 없던 세션에 종료 시 본인 태그 지정
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, END)).willReturn(1);
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, END, 0, TAG_ID);

        // when
        focusService.endFocusSession(USER_ID, body);

        // then: 세션에 태그가 보정됨
        assertThat(session.getFocusTag()).isEqualTo(tag);
    }

    // ── sweepOrphanSessions — orphan 자동 종료(GROMO-610) ────────────────────

    @Test
    @DisplayName("임계값 초과 진행 중 세션 → 조건부 UPDATE(markAutoClosedIfOpen)로 시작+상한 마감, 통계 미반영, 건수 반환")
    void sweepOrphanSessionsClosesStale() {
        // given: 24시간 전 시작해 아직 미종료인 orphan 1건
        Instant now = Instant.parse("2026-07-06T12:00:00Z");
        Instant staleStart = now.minus(Duration.ofHours(24));
        User user = User.builder().id(USER_ID).build();
        FocusSession orphan = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(staleStart).build();
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(any()))
                .willReturn(List.of(orphan));
        // GROMO-804(P2): 더티 라이트가 아니라 조건부 원자 UPDATE 로 마감 — 영향 row=1(마감 성사).
        given(focusSessionRepository.markAutoClosedIfOpen(eq(SESSION_ID), any(Instant.class)))
                .willReturn(1);

        // when
        int closed = focusService.sweepOrphanSessions(now);

        // then: 시작+12h 상한을 endedAt 으로 markAutoClosedIfOpen 호출(엔티티 autoClose 아님), 건수=1
        assertThat(closed).isEqualTo(1);
        verify(focusSessionRepository)
                .markAutoClosedIfOpen(SESSION_ID, staleStart.plus(Duration.ofHours(12)));
        // 통계·스트릭은 미반영(유저 미확정 세션)
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("GROMO-804(P2): 스윕 중 유저 PATCH 로 이미 완료된 세션(markAutoClosedIfOpen=0) → 덮어쓰지 않고 스킵, 건수 제외")
    void sweepOrphanSessionsSkipsConcurrentlyEndedSession() {
        // given: orphan 목록엔 있으나 flush 전 유저가 PATCH(endSessionIfActive)로 먼저 완료한 세션.
        // endedAt IS NULL 조건 UPDATE 라 영향 row=0 → 이미 통계 반영·정상 완료된 세션을 AUTO_CLOSED 로 덮어쓰지 않는다.
        Instant now = Instant.parse("2026-07-06T12:00:00Z");
        Instant staleStart = now.minus(Duration.ofHours(24));
        User user = User.builder().id(USER_ID).build();
        FocusSession racedOrphan = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(staleStart).build();
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(any()))
                .willReturn(List.of(racedOrphan));
        given(focusSessionRepository.markAutoClosedIfOpen(eq(SESSION_ID), any(Instant.class)))
                .willReturn(0);

        // when
        int closed = focusService.sweepOrphanSessions(now);

        // then: 조건 UPDATE 는 시도하되 성사 0 → 마감 건수에서 제외(경합 완료 세션 보호)
        assertThat(closed).isZero();
        verify(focusSessionRepository)
                .markAutoClosedIfOpen(SESSION_ID, staleStart.plus(Duration.ofHours(12)));
    }

    @Test
    @DisplayName("orphan 없음 → 0 반환, 종료 처리 없음")
    void sweepOrphanSessionsNoop() {
        // given
        given(focusSessionRepository.findByEndedAtIsNullAndStartedAtBefore(any()))
                .willReturn(List.of());

        // when
        int closed = focusService.sweepOrphanSessions(Instant.now());

        // then: 조건 UPDATE 조차 호출되지 않음
        assertThat(closed).isZero();
        verify(focusSessionRepository, never()).markAutoClosedIfOpen(any(), any());
    }
}
