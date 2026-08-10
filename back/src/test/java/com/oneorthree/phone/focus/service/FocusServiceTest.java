package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.service.CurrencyLedgerService;
import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.domain.FocusType;
import com.oneorthree.phone.focus.domain.OccupationDefaultTag;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.dto.FocusSessionCancelRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.group.service.GroupBetEarlyWinConfirmer;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagsResponse;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.OccupationDefaultTagRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
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
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
    private CurrencyLedgerService currencyLedgerService;

    // 그룹 내기 조기 확정 배선(GROMO-1268) — 세션 저장·종료 경로가 커밋 편승 호출만 하는지는
    // 통합 테스트(GroupBetEarlyWinIntegrationTest)가 본다. 여기서는 부수 호출로만 존재한다.
    @Mock
    private GroupBetEarlyWinConfirmer groupBetEarlyWinConfirmer;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID TAG_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");

    private static final Instant START = Instant.parse("2026-06-23T01:00:00Z");
    private static final Instant END = Instant.parse("2026-06-23T02:00:00Z");

    // 서버 지급(currency 폐쇄)이 저장 세션 id 로 멱등키를 만들므로, save 가 id 채워진 엔티티를 돌려주도록
    // 기본 스텁을 깐다. lenient — save 까지 안 가는 검증 실패 테스트에서 불필요 스텁 예외를 막는다.
    // id 가 필요한 개별 테스트는 이 스텁을 덮어쓴다.
    @BeforeEach
    void stubSessionSaveReturnsEntity() {
        lenient().when(focusSessionRepository.save(any(FocusSession.class)))
                .thenAnswer(inv -> inv.getArgument(0));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));

        // when & then
        assertThatThrownBy(() -> focusService.getDefaultTags(USER_ID, null))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.OCCUPATION_REQUIRED);
    }

    @Test
    @DisplayName("기본 태그 조회(미지정) — 유저 없음 → UserException(NOT_FOUND)")
    void getDefaultTagsUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        // 락 규율 (GROMO-1237): 태그 채택(변경) 트랜잭션은 공유 락 활성 조회 — 무락 findById 금지.
        verify(userRepository).findActiveByIdForShare(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
    }

    @Test
    @DisplayName("태그 생성(기존 default_tag 재사용) → default_tag 신규 저장 없이 UserFocusTag 채택")
    void setupFocusTagReusesExistingDefaultTag() {
        // given: '공부' default_tag 이미 존재 → 재사용, 새 UserFocusTag 채택
        User user = User.builder().id(USER_ID).build();
        DefaultTag existing = DefaultTag.builder().name("공부").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());
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
    @DisplayName("태그 수정 성공 → 기존 채택 소프트딜리트 + 새 이름 default_tag 로 재채택 + 과거 세션 새 태그로 재연결 (GROMO-754)")
    void updateFocusTagSuccess() {
        // given: 소유자가 USER_ID 인 커스텀 태그('이전이름'), 새 이름 '새이름' default_tag 는 신규
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

        // GROMO-754: 옛(소프트삭제) 태그를 참조하던 과거 세션을 새로 채택한 태그로 재연결
        ArgumentCaptor<UserFocusTag> repointCaptor = ArgumentCaptor.forClass(UserFocusTag.class);
        verify(focusSessionRepository).repointFocusTag(eq(tag), repointCaptor.capture());
        assertThat(repointCaptor.getValue().getDefaultTag()).isEqualTo(target);
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

        // then: 변경 없음 — 소프트딜리트/재채택 저장 없음, 세션 재연결도 없음(GROMO-754)
        assertThat(tag.getDeletedAt()).isNull();
        verify(userFocusTagRepository, never()).save(any(UserFocusTag.class));
        verify(focusSessionRepository, never()).repointFocusTag(any(UserFocusTag.class), any(UserFocusTag.class));
    }

    @Test
    @DisplayName("직군 프리셋(occupation) 태그 rename → FocusException(OCCUPATION_TAG_NOT_RENAMABLE), 소프트딜리트·재연결 없음")
    void updateFocusTagOccupationTagNotRenamable() {
        // given: sourceOccupationDefaultTag 가 있는(직군 프리셋 채택) 태그
        User owner = User.builder().id(USER_ID).build();
        UserFocusTag tag = UserFocusTag.builder()
                .id(TAG_ID)
                .user(owner)
                .defaultTag(DefaultTag.builder().name("개발").build())
                .sourceOccupationDefaultTag(OccupationDefaultTag.builder()
                        .occupation(Occupation.UNIVERSITY)
                        .build())
                .build();
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusTagUpdateRequest body = new FocusTagUpdateRequest(TAG_ID, "새이름");

        // when & then: 직군 프리셋 태그는 이름 변경 불가
        assertThatThrownBy(() -> focusService.updateFocusTag(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.OCCUPATION_TAG_NOT_RENAMABLE);
        assertThat(tag.getDeletedAt()).isNull();
        verify(focusSessionRepository, never()).repointFocusTag(any(UserFocusTag.class), any(UserFocusTag.class));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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

    @Test
    @DisplayName("POST 완료 저장 → status=COMPLETED 로 저장(ACTIVE 부정합 교정, GROMO-733)")
    void saveFocusSessionSetsCompletedStatus() {
        // given: 완료(종료 시각 포함) 세션을 통째 저장
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then: 완료 저장인데 ACTIVE 로 남던 부정합을 COMPLETED 로 교정
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(FocusSessionStatus.COMPLETED);
    }

    @Test
    @DisplayName("POST 완료 저장 focusType 지정(RANGE) → 그대로 저장, null 은 INFINITE 기본")
    void saveFocusSessionPersistsFocusType() {
        // given: focusType=RANGE
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0, FocusType.RANGE);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getFocusType()).isEqualTo(FocusType.RANGE);
    }

    @Test
    @DisplayName("POST 완료 저장 focusType 미지정(null) → INFINITE 기본값(하위호환)")
    void saveFocusSessionDefaultsFocusTypeToInfinite() {
        // given: 기존 4-arg 생성자(focusType 미지정)
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getFocusType()).isEqualTo(FocusType.INFINITE);
    }

    @Test
    @DisplayName("태그 없이 세션 저장 성공 → focusTag = null 로 저장")
    void saveFocusSessionWithoutTag() {
        // given: focusTagId == null
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, START, END, 30);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    // ── saveFocusSession — 서버 코인 지급 (currency 폐쇄) ──────────────────

    @Test
    @DisplayName("세션 저장 → 집중 60초(1분)당 1코인 서버 지급(SESSION_COMPLETE, 멱등키 focus:{id}:reward) + 응답 awardedCoins")
    void saveFocusSessionAwardsCoins() {
        // given: 1시간(3600초) 세션, 방해 30초 → 집중 3570초 → floor(3570/60) = 59코인
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(focusSessionRepository.save(any(FocusSession.class)))
                .willAnswer(inv -> FocusSession.builder().id(SESSION_ID).build());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 30);

        // when
        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID, body);

        // then: 저장 세션 id 기반 멱등키로 원장 지급 + 응답에 지급액
        verify(currencyLedgerService).credit(user, CurrencyTransactionType.SESSION_COMPLETE, 59,
                "focus:" + SESSION_ID + ":reward");
        assertThat(response.awardedCoins()).isEqualTo(59);
    }


    @Test
    @DisplayName("집중 60초(1분) 미만 세션 저장 → 코인 미지급(credit 미호출) + awardedCoins=0")
    void saveFocusSessionShortSessionNoAward() {
        // given: 59초 세션 → floor(59/60) = 0
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, START.plusSeconds(59), 0);

        // when
        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID, body);

        // then
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), any());
        assertThat(response.awardedCoins()).isZero();
    }

    // 공식 테스트 공용 '현재 시각' — 세션 종료보다 충분히 뒤라 미래 클램프가 걸리지 않는 정상 업로드 상황.
    private static final Instant FORMULA_NOW = Instant.parse("2026-06-24T00:00:00Z");

    @Test
    @DisplayName("보상 공식 — 서버 sessionRewardCoins == floor(집중초/60) (1분당 1코인, 방해 0 페이로드 기준)")
    void sessionRewardCoinsMatchesAppFormula() {
        // 서버 지급률: floor(집중초 / 60) = 1분당 1코인. 앱은 원래 floor(집중초/10)로 적립했으나 서버 지급률은
        // 오스카 결정으로 1분당 1코인으로 분기했다. distraction 0 페이로드에서 서버 집중초 = endedAt − startedAt.
        // 60초 단위 경계값(59/60/61, 119/120)으로 내림을 고정하고, 43_200초(12h)는 지급 캡 경계다.
        long[] elapsedCases = {0, 1, 59, 60, 61, 119, 120, 599, 600, 3599, 3600, 43_200};
        for (long elapsed : elapsedCases) {
            int expectedCoins = (int) (elapsed / 60);
            int serverCoins = FocusService.sessionRewardCoins(START, START.plusSeconds(elapsed), 0, FORMULA_NOW);
            assertThat(serverCoins).as("elapsed=%d초", elapsed).isEqualTo(expectedCoins);
        }
    }

    @Test
    @DisplayName("보상 공식 — 방해시간은 집중초에서 차감, 방해가 구간을 초과하면 0 (음수 방어)")
    void sessionRewardCoinsSubtractsDistraction() {
        // 방해 차감: 100초 구간 − 방해 25초 = 집중 75초 → floor(75/60) = 1코인
        assertThat(FocusService.sessionRewardCoins(START, START.plusSeconds(100), 25, FORMULA_NOW)).isEqualTo(1);
        // 방해가 구간 전체를 넘으면(비정상 페이로드) 음수 지급 없이 0
        assertThat(FocusService.sessionRewardCoins(START, START.plusSeconds(100), 200, FORMULA_NOW)).isZero();
    }

    @Test
    @DisplayName("보상 공식 — 미래 endedAt 은 now 로 클램프(미래 시각 조작분 미지급, 소폭 시계 오차는 흡수)")
    void sessionRewardCoinsClampsFutureEndedAt() {
        // endedAt 이 now 보다 1시간 미래 → 지급은 [startedAt, now] 구간(600초)만 인정 → floor(600/60) = 10코인
        Instant now = START.plusSeconds(600);
        assertThat(FocusService.sessionRewardCoins(START, START.plusSeconds(4200), 0, now)).isEqualTo(10);
        // 세션 전체가 미래(startedAt > now) → 0 (음수 방어와 동일 경로)
        assertThat(FocusService.sessionRewardCoins(now.plusSeconds(100), now.plusSeconds(200), 0, now)).isZero();
    }

    @Test
    @DisplayName("보상 공식 — 지급 인정 길이는 12h(orphan 상한 정렬) 캡: 위조 장시간 세션 대량 발행 차단")
    void sessionRewardCoinsCapsAtTwelveHours() {
        // 30일짜리 위조 세션도 12h(43_200초) = floor(43_200/60) = 720코인까지만 지급
        assertThat(FocusService.sessionRewardCoins(START, START.plusSeconds(2_592_000L), 0,
                START.plusSeconds(2_592_000L))).isEqualTo(720);
        // 캡 직전(43_199초)은 그대로 → floor(43_199/60) = 719
        assertThat(FocusService.sessionRewardCoins(START, START.plusSeconds(43_199), 0, FORMULA_NOW))
                .isEqualTo(719);
    }

    @Test
    @DisplayName("완료 세션 재업로드(동일 user·구간) → 저장·통계·지급 전부 스킵, 현재 누적으로 응답(awardedCoins=0)")
    void saveFocusSessionSkipsDuplicateReupload() {
        // 앱 업로드 대기열이 응답 유실 시 같은 바디를 재전송 — 행 재생성으로 멱등키가 무력화되는 걸 막는 경로.
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.existsByUserAndStartedAtAndEndedAtAndStatus(
                user, START, END, FocusSessionStatus.COMPLETED)).willReturn(true);
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyFocusStat.builder()
                        .user(user).date(LocalDate.of(2026, 6, 23)).totalFocusSeconds(660).sessionCount(1)
                        .build()));
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID, body);

        assertThat(response.dayTotalFocusSeconds()).isEqualTo(660);
        assertThat(response.streakQualifiedToday()).isTrue();
        assertThat(response.awardedCoins()).isZero();
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), any());
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    /**
     * GROMO-1214 코드리뷰(기기 시계 스큐) — 마커 폴백 POST 는 마커 id 로도 중복이 걸려야 한다.
     *
     * <p>기기 시계가 서버와 어긋나면 서버가 클램프해 저장한 마커 구간(서버 시각)과 폴백 바디의
     * 타임스탬프(기기 시각)가 달라 (startedAt, endedAt) 완전일치 검사를 그대로 빠져나간다 —
     * PATCH 가 커밋됐는데 응답만 유실된 폴백에서 통계·코인이 두 번 들어갔다.
     *
     * <p>코드리뷰 2차(원자성) — 판정의 1단계는 이제 존재 조회가 아니라 <b>조건부 UPDATE 선점</b>이다.
     * PATCH 가 먼저 마커를 닫았으면 선점이 0 을 돌려주고(행 잠금 덕에 커밋 순서와 무관하게 확정적),
     * 그때만 COMPLETED 여부를 확인해 스킵한다. 이 테스트가 그 '동시 폴백' 케이스다.
     */
    @Test
    @DisplayName("1214-③: PATCH 가 먼저 마커를 닫은 뒤의 동시 POST 폴백 → 선점 실패 → 구간이 달라도 저장·지급 스킵")
    void saveFocusSessionSkipsWhenMarkerAlreadyCompleted() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        // 선점 실패(row=0) = 마커가 이미 닫혔다. 구간 기준 중복 검사는 '스큐 때문에' 못 잡는 상황(스텁 없음 = false).
        given(focusSessionRepository.claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class)))
                .willReturn(0);
        given(focusSessionRepository.findByIdAndUserForUpdate(SESSION_ID, user))
                .willReturn(Optional.of(FocusSession.builder()
                        .id(SESSION_ID).user(user).status(FocusSessionStatus.COMPLETED).build()));
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0, null, SESSION_ID);

        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID, body);

        assertThat(response.awardedCoins()).isZero();
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), any());
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("1214-③: 취소·자동마감 마커의 폴백 POST(선점 실패 + COMPLETED 아님) → 정상 저장·지급")
    void saveFocusSessionSavesWhenMarkerNotCompleted() {
        // SESSION_DISCARDED 폴백 경로 — 그 마커는 통계에 한 번도 반영되지 않았으므로 새로 저장돼야 한다.
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class)))
                .willReturn(0);   // 이미 닫힌(취소·자동마감) 마커라 선점할 게 없다
        given(focusSessionRepository.findByIdAndUserForUpdate(SESSION_ID, user))
                .willReturn(Optional.of(FocusSession.builder()
                        .id(SESSION_ID).user(user).status(FocusSessionStatus.CANCELED).build()));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0, null, SESSION_ID);

        focusService.saveFocusSession(USER_ID, body);

        verify(focusSessionRepository).save(any(FocusSession.class));
    }

    /**
     * 코드리뷰 2차 ① — 마커가 아직 열려 있는 폴백(PATCH 가 네트워크로 죽었거나 재시도 가능한 409 로 롤백된 경우).
     * POST 가 마커를 선점해 닫고 완료 행을 새로 만든다. 선점이 성사됐으면 '이미 완료됐나' 조회는 볼 필요가 없다 —
     * 뒤늦게 도착한 PATCH 는 이 선점 때문에 0 행을 받아 통계에 닿지 못하므로 계상은 정확히 1회다.
     */
    @Test
    @DisplayName("1214-①: 마커가 열린 채인 POST 폴백 → 마커를 선점(CANCELED)하고 완료 행을 저장한다")
    void saveFocusSessionClaimsOpenMarkerBeforeSaving() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class)))
                .willReturn(1);
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0, null, SESSION_ID);

        focusService.saveFocusSession(USER_ID, body);

        verify(focusSessionRepository).claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class));
        verify(focusSessionRepository, never()).findByIdAndUserForUpdate(any(), any());
        verify(focusSessionRepository).save(any(FocusSession.class));
    }

    @Test
    @DisplayName("1214-①: 마커 id 없는 POST(오프라인 시작)는 선점을 시도하지 않는다 — 구간 중복 검사만")
    void saveFocusSessionSkipsClaimWithoutMarker() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        verify(focusSessionRepository, never()).claimMarkerIfActive(any(), any(), any());
        verify(focusSessionRepository).save(any(FocusSession.class));
    }

    // ── saveFocusSession — 이벤트 payload·스트릭 연동 (GROMO-395) ──────────

    @Test
    @DisplayName("태그 있는 세션 저장 → FOCUS_SESSION_COMPLETED payload 에 focus_tag_id 포함")
    void saveFocusSessionLogsWithFocusTagId() {
        // given: START~END = 3600초, 본인 소유 태그
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
    @DisplayName("세션 저장(countryCode=null) → 스트릭 갱신을 폴백 존 로컬 날짜로 호출(같은 트랜잭션, GROMO-803)")
    void saveFocusSessionUpdatesStreakWithFallbackZoneDate() {
        // given: countryCode 없는 유저 → 폴백 존(Asia/Seoul, GROMO-1252). 2026-06-22 23:55Z ~ 06-23 00:05Z
        //        = KST 06-23 08:55 ~ 09:05 → 하루 안에 들어가 조각 1개, 날짜 06-23. KR 존 케이스는 T3-KST 참고.
        Instant startedAt = Instant.parse("2026-06-22T23:55:00Z");
        Instant endedAt = Instant.parse("2026-06-23T00:05:00Z");
        User user = User.builder().id(USER_ID).build();   // countryCode 미설정 → Asia/Seoul 폴백
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, startedAt, endedAt, 0);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then
        verify(userStreakService).updateOnSessionComplete(user, List.of(LocalDate.of(2026, 6, 23)));
    }

    @Test
    @DisplayName("세션 저장 실패(태그 FORBIDDEN) → 스트릭 갱신 미호출")
    void saveFocusSessionFailureDoesNotUpdateStreak() {
        // given: 다른 유저 소유 태그
        User user = User.builder().id(USER_ID).build();
        User other = User.builder().id(OTHER_USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, other, "공부");
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        // START=01:00Z, END=02:00Z → 60분, 폴백 존(KST) 로컬 date = 2026-06-23 (10:00~11:00 KST, 하루 안)
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 30);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        DailyFocusStat stat = captor.getValue();
        // GROMO-1214 코드리뷰: totalFocusSeconds 는 방해 초를 뺀 순수 집중 시간(3600-30)
        assertThat(stat.getTotalFocusSeconds()).isEqualTo(60 * 60 - 30);
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
     * 이 케이스는 {@code countryCode==null} 유저 → 폴백 존(Asia/Seoul, GROMO-1252) 로컬 날짜로 귀속.
     * 시나리오: 07-06 22:30~23:00Z = KST 07-07 07:30~08:00 → 07-07 로 귀속(UTC 폴백이었다면 07-06).
     * (KR 유저의 존 전환 확증은 saveFocusStat_krUser_bucketsByKstDate 참고.)
     */
    @Test
    @DisplayName("T3(GROMO-803): countryCode=null 유저 → 폴백 존(Asia/Seoul) 로컬 date 에 귀속")
    void saveFocusStat_nullCountry_bucketsByFallbackZoneDate() {
        Instant startedAt = Instant.parse("2026-07-06T22:30:00Z");
        Instant endedAt = Instant.parse("2026-07-06T23:00:00Z");   // 존 없음 → KST date = 07-07
        LocalDate fallbackZoneDate = LocalDate.of(2026, 7, 7);

        User user = User.builder().id(USER_ID).build();   // countryCode 미설정 → Asia/Seoul 폴백
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(fallbackZoneDate)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, startedAt, endedAt, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 존 없음 → 폴백 존 date(07-07)로 귀속
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(fallbackZoneDate);
        assertThat(captor.getValue().getDate()).isNotEqualTo(LocalDate.of(2026, 7, 6));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
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
        verify(userStreakService).updateOnSessionComplete(krUser, List.of(kstDate));
    }

    /**
     * T3-574 (GROMO-574): 집중 저장 존 == 스크린타임 저장 존 (같은 유저·같은 country_code 존).
     * ScreenTimeService.resolveLocalDate 는 {@code reportedAt.atZone(ZonePolicy.KST)},
     * FocusService.statDate 는 {@code endedAt.atZone(ZonePolicy.KST)} — 동일 규칙이다(GROMO-1259 KST 고정).
     * 동일 유저(KR)·동일 순간(instant)을 두 도메인에 넣으면 같은 날짜에 귀속됨을 확인한다(도메인 정합).
     * 여행/국가변경(디바이스 존 ≠ country 존) 엣지는 stats package-info 문서로 수용(코드 미처리).
     */
    @Test
    @DisplayName("T3-574: 집중 저장 존 == 스크린타임 저장 존 — 같은 유저·같은 순간이 같은 날짜에 귀속(country_code 존)")
    void saveFocusStat_zoneMatchesScreenTimeZone() {
        // 경계 순간: 2026-07-12T20:00:00Z = 2026-07-13 05:00 KST (자정 넘김)
        Instant instant = Instant.parse("2026-07-12T20:00:00Z");
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();

        // 스크린타임이 같은 유저·같은 순간을 귀속시킬 날짜 = KST 고정 축(ZonePolicy, 도메인 공통 규칙)
        LocalDate screenTimeDate = instant.atZone(ZonePolicy.KST)
                .toLocalDate();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        // 구간 전체가 KST 07-13 하루 안(04:30~05:00) — 자정 분할 없이 조각 1개
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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

    /**
     * T4-2(GROMO-1049): 거대 목표에서도 짧은 세션이 '달성'으로 뒤집히지 않는다.
     *
     * <p>goal*60 을 int 로 곱하면 Integer.MAX_VALUE 목표가 -60 으로 랩어라운드해
     * {@code 3600 >= -60} 이 성립, 60분 세션이 '무한대 목표 달성'이 됐다. long 승격으로 막는다.
     * (입력 상한 @Max(1440) 이 새 값은 막지만, 이미 저장된 값·다른 경로 방어는 판정 쪽에 있어야 한다.)</p>
     */
    @Test
    @DisplayName("T4-2: goal=Integer.MAX_VALUE → 60분 세션이 달성으로 판정되지 않는다(오버플로 방어)")
    void saveFocusStat_hugeGoal_doesNotOverflowIntoAchieved() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(Integer.MAX_VALUE).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isFocusTimeGoalAchieved()).isFalse();
    }

    /**
     * T4-3(GROMO-1049): 목표를 바꾼 뒤에도 그날(statDate)에 유효했던 목표로 판정한다.
     *
     * <p>어제 목표 120분 → 오늘 60분으로 변경한 상태에서 어제 날짜 세션(60분)이 올라오면,
     * 현재 목표(60)로 판정하면 달성이지만 어제 기준(120)으로는 미달성이어야 한다.</p>
     */
    @Test
    @DisplayName("T4-3: 목표 변경 후 어제 세션 → 어제 목표(120분)로 판정해 미달성")
    void saveFocusStat_usesGoalEffectiveOnStatDate() {
        User user = User.builder().id(USER_ID).build();
        LocalDate statDate = LocalDate.of(2026, 6, 23);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(statDate)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        // 어제(6/23)까지 목표 120분 → 오늘(6/24) 60분으로 변경
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(120).build();
        settings.changeGoal(60, LocalDate.of(2026, 6, 24));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));
        // 6/23 60분 세션 — 현재 목표(60)로는 달성, 어제 목표(120)로는 미달성
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isFocusTimeGoalAchieved()).isFalse();
    }

    /** T5: UserFocusTimeSettings row 없음(목표 미설정) → 예외 없이 정상 완료, focusGoalAchieved=false 유지 */
    @Test
    @DisplayName("T5: UserFocusTimeSettings row 없음 → 예외 없음, focusGoalAchieved=false 유지")
    void saveFocusStat_noSettingsRow_skipsFlagSetting() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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

        verify(userStreakService).updateOnSessionComplete(user, List.of(date));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(date)))
                .willReturn(Optional.of(existing));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 0));

        // 게이트 통과(누적>=600) → 호출됨. "이미 인정된 날 무변화"는 UserStreakService.same-day 멱등이 담당.
        verify(userStreakService).updateOnSessionComplete(user, List.of(date));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        verify(userStreakService).updateOnSessionComplete(user, List.of(LocalDate.of(2026, 6, 23)));
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(600);
        assertThat(response.streakQualifiedToday()).isTrue();
    }

    /** ④ PATCH 종료 응답에도 dayTotalFocusSeconds·streakQualifiedToday 채워짐(미달 케이스). */
    @Test
    @DisplayName("806-④: PATCH 종료 응답 — 5분 미달 → dayTotalFocusSeconds=300, streakQualifiedToday=false")
    void endFocusSession_responseHasStreakFields_belowThreshold() {
        User user = User.builder().id(USER_ID).build();
        Instant end5m = withinClampWindow(10);                    // 클램프 창 안
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(end5m.minusSeconds(300)).build();   // 5분 세션
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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

    // ── 방해(일시정지) 초 차감 (GROMO-1214 코드리뷰 ⑤) ──────────────────────
    // 앱이 늘 0을 보내던 시절엔 일시정지가 통째로 집중으로 지급·집계됐다. 앱이 실제 값을 싣기 시작하면서
    // totalFocusSeconds 도 '순수 집중 시간'이 되도록 차감한다(지급 sessionRewardCoins 는 원래 차감했다).

    @Test
    @DisplayName("1214-⑤: 방해 초는 totalFocusSeconds 에서 빠지고, 코인도 차감 후 집중초로만 지급")
    void distraction_subtractedFromDailyStatAndCoins() {
        // 1시간 구간 + 방해 600초(10분 일시정지) → 순수 집중 3000초, 코인 floor(3000/60)=50
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 600));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        // 집중초는 차감 후, 방해초는 별도 컬럼에 그대로
        assertThat(captor.getValue().getTotalFocusSeconds()).isEqualTo(3000);
        assertThat(captor.getValue().getTotalDistractionSeconds()).isEqualTo(600);
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(3000);
        assertThat(response.awardedCoins()).isEqualTo(50);
    }

    /**
     * 방해 초는 타임스탬프가 없어 날짜별로 정확히 못 나눈다 → <b>집중초를 깎을 때만</b> 조각 길이에
     * 비례 배분하고, 마지막 조각이 잔여를 흡수해 총합을 보존한다.
     * 07-12 16:29 KST ~ 07-13 00:29 KST = 8h(28800초) → 27060초 + 1740초 조각.
     * 방해 600초 → 27060*600/28800 = 563(내림), 마지막 조각 = 600-563 = 37.
     *
     * <p>지표 컬럼({@code total_distraction_seconds})은 이 배분이 아니라 시작일에 전량 쌓인다
     * (GROMO-1252 5차 ⑥ 메타데이터 버킷 — 클라 분포가 시작일 키를 생략해도 히트맵이 안 밀리게).
     */
    @Test
    @DisplayName("1214-⑤: 자정 분할 — 방해 초는 조각 비례로 집중초를 깎고, 지표는 시작일에 전량")
    void distraction_proratedAcrossMidnightSlices() {
        Instant startedAt = Instant.parse("2026-07-12T07:29:00Z");
        Instant endedAt = Instant.parse("2026-07-12T15:29:00Z");
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 600));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, times(2)).save(captor.capture());
        List<DailyFocusStat> saved = captor.getAllValues();
        // 지표는 시작일 전량 — 집중초 차감분(563/37)과 버킷 규칙이 다르다
        assertThat(saved.get(0).getTotalDistractionSeconds()).isEqualTo(600);
        assertThat(saved.get(1).getTotalDistractionSeconds()).isZero();
        // 집중 합 = 구간 − 방해
        assertThat(saved.get(0).getTotalFocusSeconds()).isEqualTo(27060 - 563);
        assertThat(saved.get(1).getTotalFocusSeconds()).isEqualTo(1740 - 37);
        assertThat(saved.get(0).getTotalFocusSeconds() + saved.get(1).getTotalFocusSeconds())
                .isEqualTo(28800 - 600);
    }

    @Test
    @DisplayName("1214-⑤: 스트릭 10분 게이트는 차감 후 누적으로 판정 — 12분 세션 + 방해 3분이면 미인정")
    void distraction_streakGateUsesNetSeconds() {
        // 720초 구간 − 방해 180초 = 540초 < STREAK_MIN_SECONDS(600) → 스트릭 미갱신
        Instant endedAt = START.plusSeconds(720);
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, endedAt, 180));

        assertThat(response.dayTotalFocusSeconds()).isEqualTo(540);
        assertThat(response.streakQualifiedToday()).isFalse();
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("1214-⑤: 방해 초가 구간보다 커도 집중초는 음수가 아니라 0")
    void distraction_neverGoesNegative() {
        // 60초 구간에 방해 600초(있을 수 없는 조합이지만 하한 0 을 잠근다)
        Instant endedAt = START.plusSeconds(60);
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, endedAt, 600));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalFocusSeconds()).isZero();
        assertThat(response.awardedCoins()).isZero();
    }

    // ── 자정 걸친 세션의 날짜별 분할 (GROMO-1252) ──────────────────────────
    // 종전엔 endedAt 하나의 로컬 날짜에 구간 전체를 가산해 전날 몫이 통째로 사라졌다(prod 실측 10.7h 오귀속).

    /**
     * 1252-①: KR 유저의 자정 걸친 세션은 로컬 자정에서 잘려 두 날짜로 나뉘어 적립된다.
     * 07-12 16:29 KST(07:29Z) ~ 07-13 00:29 KST(15:29Z) = 8h
     * → 07-12 에 7h31m, 07-13 에 29m, 합계는 원본 구간(28800초)과 일치.
     * 세션 원본 행·sessionCount·방해초는 쪼개지 않는다(행 1건, 계수는 시작일에만).
     */
    @Test
    @DisplayName("1252-①: KR 자정 걸친 8h 세션 → 07-12 7h31m + 07-13 29m 분할, 합계 보존 · 세션 행은 1건")
    void splitMidnight_krUser_distributesSecondsAcrossDates() {
        Instant startedAt = Instant.parse("2026-07-12T07:29:00Z");   // 07-12 16:29 KST
        Instant endedAt = Instant.parse("2026-07-12T15:29:00Z");     // 07-13 00:29 KST
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 42));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, times(2)).save(captor.capture());
        List<DailyFocusStat> saved = captor.getAllValues();

        // 날짜 오름차순(시작일 먼저) — 스트릭이 과거 날짜를 무시하므로 순서 자체가 계약이다
        assertThat(saved.get(0).getDate()).isEqualTo(LocalDate.of(2026, 7, 12));
        assertThat(saved.get(1).getDate()).isEqualTo(LocalDate.of(2026, 7, 13));
        // GROMO-1214 코드리뷰: 조각 초에서 그 조각 몫의 방해 초를 뺀 순수 집중 시간이 누적된다
        // (42초를 27060:1740 으로 비례 배분 → 39 + 3). 분할 자체(7h31m/29m)는 그대로.
        assertThat(saved.get(0).getTotalFocusSeconds()).isEqualTo(7 * 3600 + 31 * 60 - 39);
        assertThat(saved.get(1).getTotalFocusSeconds()).isEqualTo(29 * 60 - 3);
        // 합 = 원본 구간 − 방해 초 (증발·부풀림 없음)
        assertThat(saved.get(0).getTotalFocusSeconds() + saved.get(1).getTotalFocusSeconds())
                .isEqualTo((int) Duration.between(startedAt, endedAt).getSeconds() - 42);
        // sessionCount·방해초(지표)는 시작일에만 — 집중초 차감 배분과는 버킷 규칙이 다르다
        assertThat(saved.get(0).getSessionCount()).isEqualTo(1);
        assertThat(saved.get(0).getTotalDistractionSeconds()).isEqualTo(42);
        assertThat(saved.get(1).getSessionCount()).isZero();
        assertThat(saved.get(1).getTotalDistractionSeconds()).isZero();
        // 세션 원본 행은 쪼개지 않는다 — 재업로드 멱등(구간 일치 조회)이 그대로 성립해야 한다
        verify(focusSessionRepository, times(1)).save(any(FocusSession.class));
    }

    /** 1252-②: 같은 날 안에서 끝나는 일반 세션은 조각 1개 — 기존 동작과 100% 동일(회귀 방지). */
    @Test
    @DisplayName("1252-②: 같은 날 안에서 끝나는 세션 → 조각 1개, 일 집계 저장·스트릭 각 1회(회귀 방지)")
    void splitMidnight_sameDaySession_singleBucket() {
        // START=01:00Z ~ END=02:00Z = KST 06-23 10:00~11:00 → 하루 안
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        LocalDate date = LocalDate.of(2026, 6, 23);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, START, END, 30));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, times(1)).save(captor.capture());
        DailyFocusStat stat = captor.getValue();
        assertThat(stat.getDate()).isEqualTo(date);
        // GROMO-1214 코드리뷰: 방해 초 차감 후(3600-30)
        assertThat(stat.getTotalFocusSeconds()).isEqualTo(60 * 60 - 30);
        assertThat(stat.getSessionCount()).isEqualTo(1);
        assertThat(stat.getTotalDistractionSeconds()).isEqualTo(30);
        verify(userStreakService, times(1)).updateOnSessionComplete(krUser, List.of(date));
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(60 * 60 - 30);
    }

    /**
     * 1252-③: 자정 분할 시 스트릭은 <b>날짜 오름차순</b>으로 호출해야 한다.
     * UserStreakService 는 lastSessionDate 이하 날짜를 조용히 무시하므로, 오늘을 먼저 넣으면 어제가 증발한다.
     * 07-12 23:50 KST(14:50Z) ~ 07-13 00:15 KST(15:15Z) → 어제 10분(경계)·오늘 15분 → 양쪽 다 인정.
     */
    @Test
    @DisplayName("1252-③: 자정 걸친 세션 스트릭 → 인정 날짜를 한 번에 넘긴다(반영 순서는 스트릭 서비스가 결정)")
    void splitMidnight_passesAllQualifiedDatesInOneCall() {
        Instant startedAt = Instant.parse("2026-07-12T14:50:00Z");   // 07-12 23:50 KST
        Instant endedAt = Instant.parse("2026-07-12T15:15:00Z");     // 07-13 00:15 KST
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        // 낱개 호출이면 소급 방향(지연 업로드)에서 오래된 날짜가 유실된다(코드리뷰 3차 ③) —
        // 어느 날짜부터 반영할지는 lastSessionDate 를 아는 UserStreakService 가 정한다.
        verify(userStreakService, times(1)).updateOnSessionComplete(krUser,
                List.of(LocalDate.of(2026, 7, 12), LocalDate.of(2026, 7, 13)));
    }

    /**
     * 1252-④: 스트릭 인정은 <b>쪼갠 뒤</b> 날짜별 누적 기준(오스카 결정 — 폴백 없음).
     * 23:55~00:05 세션은 어제 5분·오늘 5분이라 양쪽 다 10분 미달 → 어느 날짜도 인정하지 않는다.
     */
    @Test
    @DisplayName("1252-④: 23:55~00:05 세션 → 어제·오늘 각 5분이라 양쪽 다 스트릭 미인정")
    void splitMidnight_bothSlicesBelowStreakThreshold_noStreakUpdate() {
        Instant startedAt = Instant.parse("2026-07-12T14:55:00Z");   // 07-12 23:55 KST
        Instant endedAt = Instant.parse("2026-07-12T15:05:00Z");     // 07-13 00:05 KST
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        // 응답의 "그날 누적"은 종료일(07-13) 조각 기준 — 앱이 보는 오늘
        assertThat(response.dayTotalFocusSeconds()).isEqualTo(300);
        assertThat(response.streakQualifiedToday()).isFalse();
    }

    /** 1252 경계: 정확히 자정에 끝나는 세션은 그 시각이 속한 전날 조각으로 끝난다(0초짜리 다음날 row 미생성). */
    @Test
    @DisplayName("1252 경계: 정확히 자정에 끝나는 세션 → 전날 조각 1개, 0초짜리 다음날 row 없음")
    void splitMidnight_endsExactlyAtMidnight_singleBucketOnPreviousDay() {
        Instant startedAt = Instant.parse("2026-07-12T14:00:00Z");   // 07-12 23:00 KST
        Instant endedAt = Instant.parse("2026-07-12T15:00:00Z");     // 07-13 00:00 KST 정각
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, times(1)).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(LocalDate.of(2026, 7, 12));
        assertThat(captor.getValue().getTotalFocusSeconds()).isEqualTo(60 * 60);
    }

    // ── 앱이 실어 보낸 날짜별 집중초 (GROMO-1252 코드리뷰 2차 ①) ─────────────
    // 업로드 구간엔 일시정지 공백이 섞여 있어 서버 벽시계 분할만으론 날짜별 몫이 틀린다.
    // 앱 분포를 쓰되 무검증 수용은 금지 — 날짜별 벽시계 몫이 상한, 겹치지 않는 날짜는 폐기.

    /** KST 23:50 ~ 다음날 00:15 구간(벽시계 600/900), 실제 집중은 5분+5분. */
    private static final Instant CROSS_START = Instant.parse("2026-07-12T14:50:00Z");
    private static final Instant CROSS_END = Instant.parse("2026-07-12T15:15:00Z");
    private static final LocalDate CROSS_D1 = LocalDate.of(2026, 7, 12);
    private static final LocalDate CROSS_D2 = LocalDate.of(2026, 7, 13);

    private Map<LocalDate, Integer> savedSlices() {
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, atLeastOnce()).save(captor.capture());
        return captor.getAllValues().stream()
                .collect(Collectors.toMap(DailyFocusStat::getDate, DailyFocusStat::getTotalFocusSeconds));
    }

    private User givenKrUserWithEmptyStats() {
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        return krUser;
    }

    @Test
    @DisplayName("1252-①: 날짜별 집중초가 실린 업로드 → 벽시계(600/900) 대신 그 분포(300/300)로 귀속")
    void clientSecondsByDate_isUsedInsteadOfWallClockSplit() {
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 0, null,
                Map.of(CROSS_D1, 300, CROSS_D2, 300)));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 300, CROSS_D2, 300));
        // 쪼갠 뒤 양쪽 다 5분 → 스트릭 미인정(벽시계였다면 어제 10분으로 인정됐다)
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("1252-①: 분포 미전송(구버전 앱) → 종전대로 벽시계 분할(600/900) 폴백")
    void missingSecondsByDate_fallsBackToWallClockSplit() {
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 0));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 900));
    }

    @Test
    @DisplayName("1252-①: 위조 방어 — 날짜별 값은 그 날짜의 벽시계 몫으로 클램프, 세션과 겹치지 않는 날짜는 폐기")
    void clientSecondsByDate_isClampedAndFiltered() {
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 0, null,
                Map.of(CROSS_D1, 99_999,                 // 벽시계 몫 600 으로 클램프
                        CROSS_D2, 120,                    // 상한 이하 → 그대로
                        LocalDate.of(2020, 1, 1), 50_000, // 세션과 안 겹침 → 폐기
                        CROSS_D2.plusDays(1), 50_000)));  // 세션과 안 겹침 → 폐기

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 120));
    }

    @Test
    @DisplayName("1252-①: 전부 위조라 남는 날짜가 없으면 벽시계 분할로 폴백(통계 증발 방지)")
    void clientSecondsByDate_allBogus_fallsBackToWallClockSplit() {
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 0, null,
                Map.of(LocalDate.of(2020, 1, 1), 50_000)));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 900));
    }

    @Test
    @DisplayName("1252-①: PATCH 종료 경로도 날짜별 분포를 그대로 쓴다")
    void endFocusSession_usesClientSecondsByDate() {
        User krUser = givenKrUserWithEmptyStats();
        // endedAt 은 1214 의 clampToServerNow 창([now-5분, now]) 안이어야 그대로 수용된다 — 고정 과거 시각을
        // 쓰면 서버 시각으로 대체돼 스텁과 어긋난다. startedAt(마커 생성분)은 클램프 대상이 아니라 그대로 둔다.
        Instant endedAt = withinClampWindow(10);
        FocusSession session = FocusSession.builder().id(SESSION_ID).user(krUser).startedAt(CROSS_START).build();
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);

        focusService.endFocusSession(USER_ID, new FocusSessionEndRequest(SESSION_ID, endedAt, 0, null,
                Map.of(CROSS_D1, 300, CROSS_D2, 300)));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 300, CROSS_D2, 300));
        // 3차 ①: PATCH 로 완료한 세션 행에도 같은 분포가 남는다
        assertThat(session.getFocusSecondsByDate())
                .containsExactlyInAnyOrderEntriesOf(Map.of("2026-07-12", 300, "2026-07-13", 300));
    }

    // ── gross / net 구분 (GROMO-1214 코드리뷰 3차 ①) ────────────────────────
    //
    // 앱 분포는 집중 tick 합이라 **이미 일시정지가 빠진 net** 이다. 거기서 방해초를 또 빼면
    // 30분 집중 + 30분 일시정지 블록이 0초로 기록되고, 스트릭·목표 보상이 통째로 증발한다.

    private Map<LocalDate, Integer> savedDistractionSlices() {
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, atLeastOnce()).save(captor.capture());
        return captor.getAllValues().stream()
                .collect(Collectors.toMap(DailyFocusStat::getDate, DailyFocusStat::getTotalDistractionSeconds));
    }

    @Test
    @DisplayName("1214-①(3차): 분포가 실려 오면 방해초를 빼지 않는다 — 30분 집중+30분 일시정지가 0초로 죽던 회귀")
    void clientSecondsByDate_isNet_soDistractionIsNotSubtractedAgain() {
        User krUser = givenKrUserWithEmptyStats();
        // 10:00~11:00 KST(벽시계 3600) 중 절반이 일시정지 → 앱 분포는 net 1800.
        Instant startedAt = Instant.parse("2026-07-12T01:00:00Z");
        Instant endedAt = Instant.parse("2026-07-12T02:00:00Z");
        LocalDate date = LocalDate.of(2026, 7, 12);

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 1800, null,
                Map.of(date, 1800)));

        // 이중 차감이면 1800-1800 = 0 이 된다.
        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(date, 1800));
        // 방해초 컬럼은 지표로 계속 쌓인다(집중초에서 빼지 않을 뿐).
        assertThat(savedDistractionSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(date, 1800));
        // 30분이라 스트릭도 살아 있다(0초였다면 미인정).
        verify(userStreakService).updateOnSessionComplete(krUser, List.of(date));
    }

    @Test
    @DisplayName("1214-①(3차): 분포 없는 벽시계 폴백에서만 방해초를 뺀다 — 저장 분포도 net 으로 남는다")
    void wallClockFallback_subtractsDistractionAndStoresNet() {
        givenKrUserWithEmptyStats();
        Instant startedAt = Instant.parse("2026-07-12T01:00:00Z");
        Instant endedAt = Instant.parse("2026-07-12T02:00:00Z");
        LocalDate date = LocalDate.of(2026, 7, 12);

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 1800));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(date, 3600 - 1800));
        assertThat(savedDistractionSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(date, 1800));
        // 세션 행에 보관되는 분포도 net — 조회 집계(by-category)·앱 복원이 다시 빼면 안 되기 때문.
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getFocusSecondsByDate())
                .containsExactlyInAnyOrderEntriesOf(Map.of("2026-07-12", 1800));
    }

    @Test
    @DisplayName("1214-①(3차): 자정 걸친 분포 + 방해초 → 집중초는 분포 그대로(지표만 시작일에)")
    void clientSecondsByDate_crossMidnight_keepsClientSlicesIntact() {
        givenKrUserWithEmptyStats();

        // 벽시계 600/900, 앱 분포 300/300, 방해 900 → 집중초는 300/300 그대로(이중 차감 없음).
        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 900, null,
                Map.of(CROSS_D1, 300, CROSS_D2, 300)));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 300, CROSS_D2, 300));
        // 지표는 시작일 전량(GROMO-1252 5차 ⑥) — 히트맵이 세션을 하루 밀어 표시하지 않게
        assertThat(savedDistractionSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 900, CROSS_D2, 0));
    }

    /**
     * 1214-③(3차): 폐기 마커 폴백도 마커 행 잠금으로 직렬화된다.
     *
     * <p>선점(claimMarkerIfActive)이 0 행이면 잠금이 안 걸린 채 비원자적 구간 존재 조회만 남아, 타임아웃된
     * 폴백 POST 와 큐 재시도가 둘 다 '완료 구간 없음'을 보고 각각 완료 행·통계·보상을 만들 수 있었다
     * (유니크 제약 없음). 이제 상태 판정 자체를 {@code findByIdAndUserForUpdate}(PESSIMISTIC_WRITE)로 해
     * 검사~INSERT 를 마커 단위로 직렬화한다.
     */
    @Test
    @DisplayName("1214-③(3차): 폐기 마커 폴백 → 구간 중복 검사 **전에** 마커 행을 잠근다(동시 폴백 직렬화)")
    void discardedMarkerFallback_locksMarkerBeforeDuplicateCheck() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class)))
                .willReturn(0);
        given(focusSessionRepository.findByIdAndUserForUpdate(SESSION_ID, user))
                .willReturn(Optional.of(FocusSession.builder()
                        .id(SESSION_ID).user(user).status(FocusSessionStatus.AUTO_CLOSED).build()));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0, null, SESSION_ID);

        focusService.saveFocusSession(USER_ID, body);

        // 잠금 조회가 구간 중복 검사보다 먼저 — 이 순서라야 뒤선 재시도가 앞선 커밋을 보게 된다.
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(focusSessionRepository);
        order.verify(focusSessionRepository).claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class));
        order.verify(focusSessionRepository).findByIdAndUserForUpdate(SESSION_ID, user);
        order.verify(focusSessionRepository).existsByUserAndStartedAtAndEndedAtAndStatus(
                user, START, END, FocusSessionStatus.COMPLETED);
        order.verify(focusSessionRepository).save(any(FocusSession.class));
    }

    @Test
    @DisplayName("1214-③(3차): 직렬화 뒤 재시도 — 앞선 폴백이 만든 완료 구간이 보이면 저장·지급을 스킵한다")
    void discardedMarkerFallback_secondAttemptSeesCommittedRowAndSkips() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.claimMarkerIfActive(eq(SESSION_ID), eq(user), any(Instant.class)))
                .willReturn(0);
        given(focusSessionRepository.findByIdAndUserForUpdate(SESSION_ID, user))
                .willReturn(Optional.of(FocusSession.builder()
                        .id(SESSION_ID).user(user).status(FocusSessionStatus.CANCELED).build()));
        // 잠금이 풀린 시점엔 앞선 트랜잭션의 완료 행이 이미 커밋돼 있다.
        given(focusSessionRepository.existsByUserAndStartedAtAndEndedAtAndStatus(
                user, START, END, FocusSessionStatus.COMPLETED)).willReturn(true);
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, START, END, 0, null, SESSION_ID);

        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID, body);

        assertThat(response.awardedCoins()).isZero();
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), any());
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    // ── 확정 분포 보관 + 밀리초 배분 (GROMO-1252 코드리뷰 3차 ①·④) ──────────

    @Test
    @DisplayName("1252-①(3차): 확정 분포를 세션 행에 함께 저장 — 조회 집계·앱 복원이 사전집계와 같은 귀속을 쓴다")
    void savedSession_carriesResolvedSecondsByDate() {
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 0, null,
                Map.of(CROSS_D1, 300, CROSS_D2, 300)));

        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        // 사전집계에 가산한 값과 동일 — 저장 형태는 jsonb 라 ISO 문자열 키
        assertThat(captor.getValue().getFocusSecondsByDate())
                .containsExactlyInAnyOrderEntriesOf(Map.of("2026-07-12", 300, "2026-07-13", 300));
    }

    /**
     * 1252-④: 양 끝에 밀리초가 있는 구간. 조각마다 {@code Duration.getSeconds()} 로 절삭하면
     * 599+600 = 1199 가 돼 총합이 1초 줄고, 클라 분포 600/600 이 599/600 으로 클램프돼
     * 전날이 10분 스트릭 문턱을 놓친다. 누적 반올림 차분이라 총합이 보존돼야 한다.
     */
    @Test
    @DisplayName("1252-④: 밀리초가 낀 자정 걸침(23:50:00.5~00:10:00.5) → 600/600, 합 1200 보존")
    void splitMidnight_withMillis_preservesTotal() {
        Instant startedAt = Instant.parse("2026-07-12T14:50:00.500Z");   // 07-12 23:50:00.5 KST
        Instant endedAt = Instant.parse("2026-07-12T15:10:00.500Z");     // 07-13 00:10:00.5 KST
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 600));
    }

    /**
     * 1252-①(4차): 3차의 밀리초 보정(누적 반올림)이 <b>자정 분할이 없는 구간까지</b> 반올림해,
     * 599.5초짜리 같은 날 세션이 600초로 계상됐다 — 10분 스트릭·집중목표를 잘못 통과시킨다.
     * 총합은 종전({@code Duration.getSeconds()}) 대로 floor 여야 하고, 자정 분할 시 조각 합 보존
     * (바로 위 테스트)은 그대로 유지돼야 한다.
     */
    @Test
    @DisplayName("1252-①(4차): 같은 날 599.5초 세션 → 599 (총합 floor, 반올림 금지)")
    void sameDaySession_withMillis_floorsTotal() {
        Instant startedAt = Instant.parse("2026-07-12T05:00:00Z");        // 07-12 14:00:00 KST
        Instant endedAt = Instant.parse("2026-07-12T05:09:59.500Z");      // 07-12 14:09:59.5 KST
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 599));
        // 600 이었다면 10분 문턱을 넘어 스트릭이 잘못 인정된다
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("1252-④: 밀리초가 껴도 클라 분포 600/600 이 클램프로 깎이지 않아 전날 스트릭이 인정된다")
    void splitMidnight_withMillis_clientDistributionNotClampedDown() {
        Instant startedAt = Instant.parse("2026-07-12T14:50:00.500Z");
        Instant endedAt = Instant.parse("2026-07-12T15:10:00.500Z");
        User krUser = givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0, null,
                Map.of(CROSS_D1, 600, CROSS_D2, 600)));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 600));
        // 절삭이면 CROSS_D1 이 599 로 깎여 10분 문턱(600)을 놓쳤다
        verify(userStreakService).updateOnSessionComplete(krUser, List.of(CROSS_D1, CROSS_D2));
    }

    /**
     * 1252-⑤(5차): 밀리초 위상이 .500 을 <b>넘는</b> 구간. 4차의 '경계 누적 반올림'은 위상 .800 에서
     * 자정까지의 실제 duration 이 599.2초라 상한을 599 로 내려, 클라가 tick 규약대로 센 600 을 깎았다
     * (1초 유실 + 전날 10분 문턱 실패). 상한은 클라와 같은 이산 tick 경계 규약(올림)으로 나와야 한다.
     */
    @Test
    @DisplayName("1252-⑤: 위상 .800 자정 걸침 → 클라 분포 600/600 이 그대로 보존(599 로 깎이지 않음)")
    void splitMidnight_millisPhaseOverHalf_keepsClientDistribution() {
        Instant startedAt = Instant.parse("2026-07-12T14:50:00.800Z");   // 07-12 23:50:00.8 KST
        Instant endedAt = Instant.parse("2026-07-12T15:10:00.800Z");     // 07-13 00:10:00.8 KST
        User krUser = givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0, null,
                Map.of(CROSS_D1, 600, CROSS_D2, 600)));

        assertThat(savedSlices()).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 600));
        // 반올림 상한(599)이면 전날이 10분 문턱을 놓쳐 CROSS_D2 만 인정됐다
        verify(userStreakService).updateOnSessionComplete(krUser, List.of(CROSS_D1, CROSS_D2));
    }

    /** 1252-⑤(5차): 클라 분포가 없는 구버전 앱의 벽시계 폴백도 같은 규약 — 총합 floor(1200)은 그대로. */
    @Test
    @DisplayName("1252-⑤: 위상 .800 벽시계 폴백 → 600/600, 합 1200(총합 floor) 보존")
    void splitMidnight_millisPhaseOverHalf_wallClockFallback() {
        Instant startedAt = Instant.parse("2026-07-12T14:50:00.800Z");
        Instant endedAt = Instant.parse("2026-07-12T15:10:00.800Z");
        givenKrUserWithEmptyStats();

        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        Map<LocalDate, Integer> slices = savedSlices();
        assertThat(slices).containsExactlyInAnyOrderEntriesOf(Map.of(CROSS_D1, 600, CROSS_D2, 600));
        assertThat(slices.values().stream().mapToInt(Integer::intValue).sum())
                .isEqualTo((int) Duration.between(startedAt, endedAt).getSeconds());
    }

    /**
     * 1252-⑥(5차): 클라 분포는 그날 tick 이 하나도 없으면 <b>시작일 키를 생략</b>한다
     * (23:50 시작 → 자정 넘겨 정지 → 00:10 첫 tick). '첫 조각 = 시작일' 가정이 깨져 세션 1건과 방해초
     * 전량이 다음날에 붙었다 — 히트맵이 세션을 틀린 날짜로 표시한다. 메타데이터 버킷은 startedAt 에서
     * 직접 파생해야 하고, 그 결과 시작일에 집중초 0 인 행이 새로 생기는 게 맞는 동작이다.
     */
    @Test
    @DisplayName("1252-⑥: 시작일 조각이 없는 분포 → sessionCount·방해초는 시작일, 집중초는 다음날")
    void sessionMetadata_attachesToStartDate_evenWhenStartDaySliceMissing() {
        User krUser = givenKrUserWithEmptyStats();

        // CROSS_START(07-12 23:50 KST) 시작이지만 tick 은 자정 뒤에만 발생 → 07-13 키 하나만 온다.
        focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, CROSS_START, CROSS_END, 42, null,
                Map.of(CROSS_D2, 900)));

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, times(2)).save(captor.capture());
        List<DailyFocusStat> saved = captor.getAllValues();

        // 시작일 행 — 집중초 0 이지만 '그날 세션을 시작했다'는 사실(세션 수·방해초)을 담는다
        assertThat(saved.get(0).getDate()).isEqualTo(CROSS_D1);
        assertThat(saved.get(0).getTotalFocusSeconds()).isZero();
        assertThat(saved.get(0).getSessionCount()).isEqualTo(1);
        assertThat(saved.get(0).getTotalDistractionSeconds()).isEqualTo(42);
        // 다음날 행 — 집중초만. 세션 수·방해초가 여기 붙으면 히트맵이 세션을 하루 밀어 표시한다
        assertThat(saved.get(1).getDate()).isEqualTo(CROSS_D2);
        assertThat(saved.get(1).getTotalFocusSeconds()).isEqualTo(900);
        assertThat(saved.get(1).getSessionCount()).isZero();
        assertThat(saved.get(1).getTotalDistractionSeconds()).isZero();
        // 0초짜리 시작일은 스트릭 자격이 없다(10분 미만) — 인정 날짜는 집중초가 쌓인 날뿐
        verify(userStreakService).updateOnSessionComplete(krUser, List.of(CROSS_D2));
    }

    /**
     * 1252-⑤: 정확히 로컬 자정에 끝난 세션은 조각을 <b>전날</b>에 남긴다(0초짜리 다음날 조각 미생성).
     * 중복 업로드 응답의 조회 날짜를 endedAt 에서 직접 파생하면 최초 요청(전날)과 재시도(다음날)가
     * 다른 완료 판정을 발행한다 — 조각에 실제로 쓰인 마지막 날짜에서 파생해야 한다.
     */
    @Test
    @DisplayName("1252-⑤: 자정 정각 종료 세션의 재업로드 → 최초와 같은 날짜(전날) 누적·판정을 돌려준다")
    void duplicateReupload_atExactMidnight_readsLastSliceDate() {
        Instant startedAt = Instant.parse("2026-07-12T14:00:00Z");   // 07-12 23:00 KST
        Instant endedAt = Instant.parse("2026-07-12T15:00:00Z");     // 07-13 00:00 KST 정각
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(focusSessionRepository.existsByUserAndStartedAtAndEndedAtAndStatus(
                krUser, startedAt, endedAt, FocusSessionStatus.COMPLETED)).willReturn(true);
        // 07-12(조각이 쓰인 날)에만 누적이 있고 07-13 은 비어 있다 — 날짜를 잘못 고르면 0/false 가 나간다.
        given(dailyFocusStatRepository.findByUserAndDate(krUser, LocalDate.of(2026, 7, 12)))
                .willReturn(Optional.of(DailyFocusStat.builder()
                        .user(krUser).date(LocalDate.of(2026, 7, 12)).totalFocusSeconds(3600).build()));

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, endedAt, 0));

        assertThat(response.dayTotalFocusSeconds()).isEqualTo(3600);
        assertThat(response.streakQualifiedToday()).isTrue();
    }

    @Test
    @DisplayName("1252-⑤: 앱 분포가 어제까지만 있으면 재업로드 응답도 어제 기준")
    void duplicateReupload_followsClientSecondsByDate() {
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(focusSessionRepository.existsByUserAndStartedAtAndEndedAtAndStatus(
                krUser, CROSS_START, CROSS_END, FocusSessionStatus.COMPLETED)).willReturn(true);
        given(dailyFocusStatRepository.findByUserAndDate(krUser, CROSS_D1))
                .willReturn(Optional.of(DailyFocusStat.builder()
                        .user(krUser).date(CROSS_D1).totalFocusSeconds(900).build()));

        // 자정 전에 멈춰 다음날 집중이 0 인 세션(일시정지 상태로 자정 통과)
        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID,
                new FocusSessionRequest(null, CROSS_START, CROSS_END, 0, null, Map.of(CROSS_D1, 300)));

        assertThat(response.dayTotalFocusSeconds()).isEqualTo(900);
    }

    // ── 미래 endedAt 클램프 (GROMO-1252 코드리뷰 P1) ────────────────────────
    // 클램프가 없으면 '방금 시작해 내일 끝나는' 위조 세션이 오늘 자정까지의 초를 오늘 조각에 채워
    // 오늘 스트릭·집중목표 지급을 즉시 달성시킨다(creditFocusGoal 의 미래 날짜 가드는 statDate 가 오늘이라 무력).

    /**
     * 1252-⑤: 미래 endedAt 위조 세션 — 통계 귀속은 서버 now 까지만. 실제 경과 5분만 오늘에 쌓이므로
     * 스트릭(10분)·목표(60분) 어느 쪽도 달성되지 않는다. 저장되는 세션 행의 endedAt 은 앱이 보낸 값 그대로여야
     * 재업로드 중복 검사(existsByUserAndStartedAtAndEndedAtAndStatus)가 성립한다.
     */
    @Test
    @DisplayName("1252-⑤: 미래 endedAt(내일) 세션 → 오늘 통계는 실경과 5분만, 스트릭·목표 지급 없음(세션 행 endedAt 은 원본 유지)")
    void futureEndedAt_clampedForStatsOnly() {
        Instant now = Instant.now();
        Instant startedAt = now.minusSeconds(300);       // 실제로는 5분짜리 세션
        Instant forgedEnd = now.plusSeconds(24 * 3600);  // 내일 끝난다고 위조
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        LocalDate todayKst = now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(
                UserFocusTimeSettings.builder().userId(USER_ID).dailyFocusTimeGoalMinutes(60).build()));

        FocusSessionSaveResponse response =
                focusService.saveFocusSession(USER_ID, new FocusSessionRequest(null, startedAt, forgedEnd, 0));

        // 오늘 조각 하나만, 실경과(≈300초)만 적립 — 자정까지의 초가 들어오지 않는다
        ArgumentCaptor<DailyFocusStat> statCaptor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository, times(1)).save(statCaptor.capture());
        DailyFocusStat stat = statCaptor.getValue();
        assertThat(stat.getDate()).isEqualTo(todayKst);
        assertThat(stat.getTotalFocusSeconds()).isBetween(295, 310);
        assertThat(stat.isFocusTimeGoalAchieved()).isFalse();
        // 스트릭(10분 미만)·목표 지급 없음
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        verify(currencyLedgerService, never()).credit(any(), eq(CurrencyTransactionType.FOCUS_GOAL), anyInt(), any());
        assertThat(response.goalRewardCoins()).isZero();
        // 세션 원본 행은 클램프하지 않는다 — 재업로드 멱등(구간 일치 조회)이 깨지면 이중 계상된다
        ArgumentCaptor<FocusSession> sessionCaptor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(sessionCaptor.capture());
        assertThat(sessionCaptor.getValue().getEndedAt()).isEqualTo(forgedEnd);
        // 1252-②: 대신 통계 귀속용 유효 종료는 완료 시점 클램프로 고정 보관한다 — 조회가 시간이 갈수록
        // 더 세지 않게 하는 근거(by-category 는 이 값으로 자른다).
        assertThat(sessionCaptor.getValue().getStatEndAt()).isBetween(now, now.plusSeconds(30));
        assertThat(sessionCaptor.getValue().statEndOrEndedAt())
                .isEqualTo(sessionCaptor.getValue().getStatEndAt());
    }

    /** 1252-⑥: 구간이 통째로 미래인 세션 — 조각이 하나도 없어야 한다(음수 초·유령 row 방지). */
    @Test
    @DisplayName("1252-⑥: startedAt·endedAt 이 모두 미래 → 일 집계 row 미생성, 스트릭 미갱신")
    void whollyFutureSession_producesNoStatSlices() {
        Instant now = Instant.now();
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));

        FocusSessionSaveResponse response = focusService.saveFocusSession(USER_ID, new FocusSessionRequest(
                null, now.plusSeconds(3600), now.plusSeconds(7200), 0));

        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        verify(dailyFocusStatRepository, never()).findByUserAndDateForUpdate(any(), any());
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        assertThat(response.dayTotalFocusSeconds()).isZero();
        assertThat(response.streakQualifiedToday()).isFalse();
    }

    // ── DAILY_FOCUS_GOAL_ACHIEVED 이벤트 (GROMO-395 커밋 4) ─────────────────

    /** E1: insert 경로 — 신규 row 가 곧바로 달성(false→true 전이와 동일) → 이벤트 1회 발행 */
    @Test
    @DisplayName("E1: 첫 세션으로 목표 도달(insert 경로) → DAILY_FOCUS_GOAL_ACHIEVED 1회 발행")
    void saveFocusStat_insertPath_goalAchieved_emitsEvent() {
        // goal=60, START~END = 60분 세션 → 신규 row 즉시 달성
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        // given: startedAt 은 클램프 창(과거 5분) 안 = 그대로 수용 (GROMO-1214)
        Instant startedAt = withinClampWindow(30);
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        given(focusSessionRepository.save(any(FocusSession.class)))
                .willAnswer(inv -> FocusSession.builder()
                        .id(sessionId)
                        .user(user)
                        .focusTag(tag)
                        .startedAt(startedAt)
                        .build());
        FocusSessionStartRequest body = new FocusSessionStartRequest(TAG_ID, startedAt);

        // when
        FocusSessionStartResponse response = focusService.startFocusSession(USER_ID, body);

        // then: 저장된 세션은 endedAt null(진행 중), 응답에 생성 id·startedAt
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getEndedAt()).isNull();
        assertThat(captor.getValue().getStartedAt()).isEqualTo(startedAt);
        assertThat(response.sessionId()).isEqualTo(sessionId);
        assertThat(response.startedAt()).isEqualTo(startedAt);
        // 시작 시엔 통계·스트릭 미반영
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
    }

    @Test
    @DisplayName("startedAt 미지정 → 서버 시각(now) 사용, 세션 저장")
    void startFocusSessionDefaultsStartedAt() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusSessionStartRequest body = new FocusSessionStartRequest(TAG_ID, START);

        // when & then
        assertThatThrownBy(() -> focusService.startFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    // ── startFocusSession — focus_type 인입(GROMO-733) ──────────────────────

    @Test
    @DisplayName("focusType 지정(POMODORO) → 세션에 그대로 저장")
    void startFocusSessionPersistsFocusType() {
        // given: 요청에 focusType=POMODORO
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        FocusSessionStartRequest body = new FocusSessionStartRequest(null, START, FocusType.POMODORO);

        // when
        focusService.startFocusSession(USER_ID, body);

        // then: 저장된 세션의 focusType=POMODORO
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getFocusType()).isEqualTo(FocusType.POMODORO);
    }

    @Test
    @DisplayName("focusType 미지정(null) → INFINITE 기본값으로 저장(하위호환)")
    void startFocusSessionDefaultsFocusTypeToInfinite() {
        // given: 요청 focusType=null
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));
        FocusSessionStartRequest body = new FocusSessionStartRequest(null, START, null);

        // when
        focusService.startFocusSession(USER_ID, body);

        // then: null → INFINITE 기본값
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getFocusType()).isEqualTo(FocusType.INFINITE);
    }

    // ── endFocusSession — 라이브 세션 종료(GROMO-610) ────────────────────────

    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-0000000000f1");

    // GROMO-1214: 마커 경로(start/PATCH)는 클라 시각을 [now-5분, now] 창으로 클램프한다 — 고정 과거 시각
    // (START/END)을 그대로 보내면 서버 시각으로 대체돼 스텁이 어긋난다. 마커 테스트는 창 안의 값을 쓴다.
    private static Instant withinClampWindow(int secondsAgo) {
        return Instant.now().minusSeconds(secondsAgo);
    }

    @Test
    @DisplayName("라이브 세션 종료 성공 → endedAt 채움 + 통계·스트릭 귀속, 요약 반환")
    void endFocusSessionSuccess() {
        // given: 본인 소유 진행 중 세션 (endedAt 은 클램프 창 안 = 그대로 수용)
        Instant endedAt = withinClampWindow(10);
        Instant startedAt = endedAt.minusSeconds(3600);
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(startedAt).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, endedAt, 30, null);

        // when
        FocusSessionEndResponse response = focusService.endFocusSession(USER_ID, body);

        // then: 세션에 endedAt·방해지표 반영(더티 체킹)
        assertThat(session.getEndedAt()).isEqualTo(endedAt);
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

    @Test
    @DisplayName("종료 성사 → 관리 엔티티 end() 더티 flush 로 status=COMPLETED 전이(GROMO-733)")
    void endFocusSessionTransitionsToCompleted() {
        // given: 본인 소유 진행 중(ACTIVE) 세션, 조건부 종료 성사(row=1)
        Instant endedAt = withinClampWindow(10);
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(endedAt.minusSeconds(3600)).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, endedAt, 0, null);

        // when
        focusService.endFocusSession(USER_ID, body);

        // then: end() 안에서 status=COMPLETED 로 전이(벌크 endSessionIfActive 는 status-agnostic 유지)
        assertThat(session.getStatus()).isEqualTo(FocusSessionStatus.COMPLETED);
    }

    /**
     * T3-KST-END (GROMO-803): 라이브 PATCH 종료도 country_code(KR) 존(KST) 로컬 날짜로 버킷팅된다.
     * saveFocusSession 의 saveFocusStat_krUser_bucketsByKstDate 를 endFocusSession 경로로 미러링한다.
     *
     * <p>GROMO-1214 로 PATCH 의 endedAt 이 서버 수신 시각 창으로 클램프되면서 고정 시각(20:00Z)을 심을 수
     * 없게 됐다 — 창 안의 실시간 값으로 바꾸고, 버킷 날짜를 그 값의 KST 로컬 날짜와 대조한다.
     * (UTC였다면 다른 날짜가 되는 고정 시각 대비는 POST 쌍둥이 테스트 saveFocusStat_krUser_bucketsByKstDate 가 유지.)
     */
    @Test
    @DisplayName("T3-KST-END(GROMO-803): KR 유저 라이브 종료 → statDate 는 endedAt 의 KST 로컬 날짜(UTC 아님)")
    void endFocusSession_krUser_bucketsByKstDate() {
        Instant endedAt = withinClampWindow(30);
        Instant startedAt = endedAt.minusSeconds(1800);
        LocalDate kstDate = endedAt.atZone(ZonePolicy.KST).toLocalDate();

        // given: KR 유저의 본인 소유 진행 중(ACTIVE) 세션 + 조건부 종료 성사(row=1)
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(krUser).startedAt(startedAt).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(krUser));
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

        // then: DailyFocusStat 은 KST 로컬 날짜로 버킷팅
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
        // 스트릭도 같은 statDate 로 갱신 — any() 가 아니라 eq(kstDate) 로 확증
        verify(userStreakService).updateOnSessionComplete(eq(krUser), eq(List.of(kstDate)));
    }

    @Test
    @DisplayName("endedAt 미지정 → 서버 시각(now)으로 종료")
    void endFocusSessionDefaultsEndedAt() {
        // given
        User user = User.builder().id(USER_ID).build();
        Instant recentStart = Instant.now().minusSeconds(60);
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(recentStart).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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

    /**
     * GROMO-1214 코드리뷰 ① — 409 의 원인을 코드로 갈라 준다.
     *
     * <p>취소(CANCELED)·자동마감(AUTO_CLOSED) 마커는 통계·지급에 한 번도 반영되지 않은 상태다
     * (집계 관례가 status NOT IN (CANCELED, AUTO_CLOSED)). 이걸 '이미 종료됨'과 같은 409 로 뭉뚱그리면
     * 앱이 POST 폴백을 못 해 그 세션 시간이 영구 유실된다(안드로이드 시스템 뒤로가기 → 4분 내 재실행 시
     * 고아 정산이 취소된 마커에 PATCH 를 쏘는 실제 경로).
     *
     * <p>판정은 DB 재조회(findStatusById)로 한다 — findById 로 로드한 엔티티는 UPDATE 이전 스냅샷이라
     * 동시 취소를 못 본다.
     */
    @Test
    @DisplayName("1214-①: 취소된 마커 종료 시도 → FocusException(SESSION_DISCARDED) — 앱이 POST 폴백 가능")
    void endFocusSessionCanceledMarkerIsDiscarded() {
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(0);
        given(focusSessionRepository.findStatusById(SESSION_ID))
                .willReturn(Optional.of(FocusSessionStatus.CANCELED));
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, null, 0, null);

        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_DISCARDED);
        // 폐기 마커도 통계·지급은 절대 건드리지 않는다(폴백 POST 가 새로 저장할 몫)
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        verify(currencyLedgerService, never()).credit(any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("1214-①: 자동마감(AUTO_CLOSED) 마커 종료 시도 → SESSION_DISCARDED")
    void endFocusSessionAutoClosedMarkerIsDiscarded() {
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(0);
        given(focusSessionRepository.findStatusById(SESSION_ID))
                .willReturn(Optional.of(FocusSessionStatus.AUTO_CLOSED));
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, null, 0, null);

        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_DISCARDED);
    }

    @Test
    @DisplayName("1214-①: 이미 COMPLETED 인 마커는 SESSION_ALREADY_ENDED — 앱이 폴백하면 이중 지급이라 구분 유지")
    void endFocusSessionCompletedMarkerIsAlreadyEnded() {
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).endedAt(END).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(0);
        given(focusSessionRepository.findStatusById(SESSION_ID))
                .willReturn(Optional.of(FocusSessionStatus.COMPLETED));
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, null, 0, null);

        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_ALREADY_ENDED);
    }

    @Test
    @DisplayName("동시/중복 PATCH — 조건부 종료 패배(row=0) 시 통계·스트릭·이벤트 미반영(멱등)")
    void endFocusSessionConcurrentDuplicateIsIdempotent() {
        // given: 본인 진행 중 세션을 읽었으나, findById~UPDATE 사이 다른 요청이 먼저 종료해 조건부 UPDATE 가 0행
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
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
        // given: 둘 다 클램프 창 안이지만 endedAt 이 startedAt 보다 앞섬(클램프로 가려지지 않는 진짜 역전)
        Instant startedAt = withinClampWindow(60);
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(startedAt).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, startedAt.minusSeconds(60), 0, null);

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
        Instant endedAt = withinClampWindow(10);
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tag = userFocusTag(TAG_ID, user, "공부");
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(endedAt.minusSeconds(3600)).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);
        given(userFocusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, endedAt, 0, TAG_ID);

        // when
        focusService.endFocusSession(USER_ID, body);

        // then: 세션에 태그가 보정됨
        assertThat(session.getFocusTag()).isEqualTo(tag);
    }

    // ── PATCH 종료 지급 + 클라 시각 클램프 (GROMO-1214) ──────────────────────
    // 앱이 'cancel + POST' 를 'PATCH' 로 전환하면 라이브 마커 종료가 유일한 세션 지급처가 된다.

    @Test
    @DisplayName("1214-①: PATCH 종료 → 세션 코인 지급(SESSION_COMPLETE, 멱등키 focus:{id}:reward), 금액은 POST 와 동일")
    void endFocusSessionAwardsSessionCoins() {
        // given: 1시간 세션 + 방해 30초 → 집중 3570초 → floor(3570/60) = 59코인 (POST 쌍둥이 saveFocusSessionAwardsCoins 와 같은 값)
        Instant endedAt = withinClampWindow(10);
        Instant startedAt = endedAt.minusSeconds(3600);
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(startedAt).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when
        FocusSessionEndResponse response =
                focusService.endFocusSession(USER_ID, new FocusSessionEndRequest(SESSION_ID, endedAt, 30, null));

        // then: 마커 세션 id 기반 멱등키로 지급 + 응답에 지급액
        verify(currencyLedgerService).credit(user, CurrencyTransactionType.SESSION_COMPLETE, 59,
                "focus:" + SESSION_ID + ":reward");
        assertThat(response.awardedCoins()).isEqualTo(59);
        // POST 와 지급 공식이 한 곳(sessionRewardCoins)으로 모였는지 — 같은 구간이면 같은 금액
        assertThat(FocusService.sessionRewardCoins(startedAt, endedAt, 30, Instant.now())).isEqualTo(59);
    }

    @Test
    @DisplayName("1214-②: PATCH 응답에 awardedCoins·goalRewardCoins·balanceAfter 가 실린다(POST 응답과 동일 필드)")
    void endFocusSessionResponseCarriesRewardFields() {
        // given: 1시간 세션 + 하루 목표 60분 → 목표 첫 달성(false→true)으로 목표 보상 10코인(1시간 티어)
        Instant endedAt = withinClampWindow(10);
        Instant startedAt = endedAt.minusSeconds(3600);
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(startedAt).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(SESSION_ID, endedAt)).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build()));
        given(currencyLedgerService.balanceOf(user)).willReturn(137);

        // when
        FocusSessionEndResponse response =
                focusService.endFocusSession(USER_ID, new FocusSessionEndRequest(SESSION_ID, endedAt, 0, null));

        // then
        assertThat(response.awardedCoins()).isEqualTo(60);
        assertThat(response.goalRewardCoins()).isEqualTo(10);
        assertThat(response.balanceAfter()).isEqualTo(137);
    }

    @Test
    @DisplayName("1214-③: 이중 PATCH → 두 번째는 409(SESSION_ALREADY_ENDED)이고 코인은 한 번만 지급")
    void endFocusSessionDoublePatchPaysOnce() {
        // given: 첫 PATCH 는 조건부 UPDATE 성사(1), 두 번째는 이미 종료돼 0행
        Instant endedAt = withinClampWindow(10);
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(endedAt.minusSeconds(3600)).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(1, 0);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionEndRequest body = new FocusSessionEndRequest(SESSION_ID, endedAt, 0, null);

        // when: 같은 세션을 두 번 종료
        focusService.endFocusSession(USER_ID, body);

        // then: 두 번째는 409 이고 지급은 1회뿐(원자 가드가 이중 지급을 막는다)
        assertThatThrownBy(() -> focusService.endFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_ALREADY_ENDED);
        verify(currencyLedgerService, times(1))
                .credit(eq(user), eq(CurrencyTransactionType.SESSION_COMPLETE), anyInt(), any());
    }

    @Test
    @DisplayName("1214-④: 12시간 전으로 조작한 startedAt → 서버 수신 시각으로 대체(시간 뻥튀기 차단)")
    void startFocusSessionClampsBackdatedStartedAt() {
        // given: 창(과거 5분) 밖의 startedAt
        Instant backdated = Instant.now().minus(Duration.ofHours(12));
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.save(any(FocusSession.class))).willAnswer(inv -> inv.getArgument(0));

        // when
        Instant before = Instant.now();
        FocusSessionStartResponse response =
                focusService.startFocusSession(USER_ID, new FocusSessionStartRequest(null, backdated));

        // then: 저장·응답 모두 서버 시각 — 조작한 12시간은 반영되지 않는다
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        assertThat(captor.getValue().getStartedAt()).isAfterOrEqualTo(before);
        assertThat(response.startedAt()).isAfterOrEqualTo(before);
    }

    @Test
    @DisplayName("1214-⑤: 미래로 조작한 endedAt → 서버 수신 시각으로 대체")
    void endFocusSessionClampsFutureEndedAt() {
        // given: 1시간 뒤 endedAt (미래는 0분도 허용하지 않는다)
        Instant future = Instant.now().plus(Duration.ofHours(1));
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(Instant.now().minusSeconds(600)).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.endSessionIfActive(eq(SESSION_ID), any())).willReturn(1);
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when
        Instant before = Instant.now();
        FocusSessionEndResponse response =
                focusService.endFocusSession(USER_ID, new FocusSessionEndRequest(SESSION_ID, future, 0, null));

        // then: DB 종료 UPDATE·엔티티·응답 모두 서버 시각(미래 미반영)
        ArgumentCaptor<Instant> endedAtCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).endSessionIfActive(eq(SESSION_ID), endedAtCaptor.capture());
        assertThat(endedAtCaptor.getValue()).isAfterOrEqualTo(before).isBefore(future);
        assertThat(session.getEndedAt()).isEqualTo(endedAtCaptor.getValue());
        assertThat(response.endedAt()).isEqualTo(endedAtCaptor.getValue());
    }

    @Test
    @DisplayName("1214-⑥: 클램프 창 — 과거 5분 이내·현재는 그대로 수용, 창 밖(과거 5분 초과·미래·null)은 now")
    void clampToServerNowAcceptsValuesInsideWindow() {
        Instant now = Instant.parse("2026-08-08T10:00:00Z");
        // 창 안: 그대로 수용 (정상 클라 회귀 방지)
        assertThat(FocusService.clampToServerNow(now, now)).isEqualTo(now);
        assertThat(FocusService.clampToServerNow(now.minusSeconds(60), now)).isEqualTo(now.minusSeconds(60));
        // 경계(정확히 5분 전)는 포함
        Instant fiveMinutesAgo = now.minus(Duration.ofMinutes(5));
        assertThat(FocusService.clampToServerNow(fiveMinutesAgo, now)).isEqualTo(fiveMinutesAgo);
        // 창 밖: now 로 대체
        assertThat(FocusService.clampToServerNow(fiveMinutesAgo.minusSeconds(1), now)).isEqualTo(now);
        assertThat(FocusService.clampToServerNow(now.plusSeconds(1), now)).isEqualTo(now);
        assertThat(FocusService.clampToServerNow(null, now)).isEqualTo(now);
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

    // ── cancelFocusSession — 세션 취소(GROMO-733) ────────────────────────────

    @Test
    @DisplayName("취소 성사 → 조건부 UPDATE(cancelSessionIfActive)로 마감 + 관리 엔티티 cancel() 전이(CANCELED)")
    void cancelFocusSessionSuccess() {
        // given: 본인 소유 진행 중(ACTIVE) 세션, 조건부 취소 성사(row=1)
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).build();
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.cancelSessionIfActive(eq(SESSION_ID), any())).willReturn(1);
        FocusSessionCancelRequest body = new FocusSessionCancelRequest(SESSION_ID);

        // when
        focusService.cancelFocusSession(USER_ID, body);

        // then: 조건부 원자 UPDATE 호출 + 관리 엔티티가 CANCELED·endedAt 로 전이(더티 flush)
        verify(focusSessionRepository).cancelSessionIfActive(eq(SESSION_ID), any());
        assertThat(session.getStatus()).isEqualTo(FocusSessionStatus.CANCELED);
        assertThat(session.getEndedAt()).isNotNull();
        // 취소는 통계·스트릭·완료 이벤트를 귀속하지 않는다
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        verify(userStreakService, never()).updateOnSessionComplete(any(), any());
        verify(userActivityEventLogger, never()).log(eq(UserActivityEvent.FOCUS_SESSION_COMPLETED), anyMap());
    }

    @Test
    @DisplayName("이미 종료/취소된 세션 재취소 → 조건부 UPDATE row=0 → FocusException(SESSION_ALREADY_ENDED), 멱등")
    void cancelFocusSessionAlreadyEnded() {
        // given: 조건부 취소 UPDATE 가 0행(endedAt IS NULL 아님 = 이미 종료/취소됨)
        User user = User.builder().id(USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(user).startedAt(START).endedAt(END).build();
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        given(focusSessionRepository.cancelSessionIfActive(eq(SESSION_ID), any())).willReturn(0);
        FocusSessionCancelRequest body = new FocusSessionCancelRequest(SESSION_ID);

        // when & then
        assertThatThrownBy(() -> focusService.cancelFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_ALREADY_ENDED);
    }

    @Test
    @DisplayName("존재하지 않는 세션 취소 → FocusException(SESSION_NOT_FOUND), 조건부 UPDATE 미호출")
    void cancelFocusSessionNotFound() {
        // given
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.empty());
        FocusSessionCancelRequest body = new FocusSessionCancelRequest(SESSION_ID);

        // when & then
        assertThatThrownBy(() -> focusService.cancelFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.SESSION_NOT_FOUND);
        verify(focusSessionRepository, never()).cancelSessionIfActive(any(), any());
    }

    @Test
    @DisplayName("타인 세션 취소 → FocusException(FORBIDDEN), 조건부 UPDATE 미호출")
    void cancelFocusSessionForbidden() {
        // given: 세션 소유자가 OTHER_USER_ID
        User other = User.builder().id(OTHER_USER_ID).build();
        FocusSession session = FocusSession.builder()
                .id(SESSION_ID).user(other).startedAt(START).build();
        given(focusSessionRepository.findById(SESSION_ID)).willReturn(Optional.of(session));
        FocusSessionCancelRequest body = new FocusSessionCancelRequest(SESSION_ID);

        // when & then
        assertThatThrownBy(() -> focusService.cancelFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).cancelSessionIfActive(any(), any());
    }
}
