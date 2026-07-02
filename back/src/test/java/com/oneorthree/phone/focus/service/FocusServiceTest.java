package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.FocusTag;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.FocusTagRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.Disabled;
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

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
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
    private FocusTagRepository focusTagRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID TAG_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");

    private static final Instant START = Instant.parse("2026-06-23T01:00:00Z");
    private static final Instant END = Instant.parse("2026-06-23T02:00:00Z");

    // ── getFocusTags ──────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 목록 조회 성공 → FocusTagResponse 리스트 매핑")
    void getFocusTagsSuccess() {
        // given: findById(USER_ID) → User, findByUser → 태그 2개
        User user = User.builder().id(USER_ID).build();
        UUID tagId2 = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
        FocusTag tag1 = FocusTag.builder().id(TAG_ID).user(user).name("공부").build();
        FocusTag tag2 = FocusTag.builder().id(tagId2).user(user).name("운동").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusTagRepository.findByUserAndDeletedAtIsNull(user)).willReturn(List.of(tag1, tag2));

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

    // ── setupFocusTag ─────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 생성 성공 → FocusTag 저장")
    void setupFocusTagSuccess() {
        // given
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        FocusTagSetupRequest body = new FocusTagSetupRequest("공부");

        // when
        focusService.setupFocusTag(USER_ID, body);

        // then: 저장된 태그의 user/name 검증
        ArgumentCaptor<FocusTag> captor = ArgumentCaptor.forClass(FocusTag.class);
        verify(focusTagRepository).save(captor.capture());
        assertThat(captor.getValue().getUser()).isEqualTo(user);
        assertThat(captor.getValue().getName()).isEqualTo("공부");
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
        verify(focusTagRepository, never()).save(any(FocusTag.class));
    }

    // ── updateFocusTag ────────────────────────────────────────────────────

    @Test
    @DisplayName("태그 수정 성공 → 이름 변경")
    void updateFocusTagSuccess() {
        // given: 소유자가 USER_ID 인 태그
        User owner = User.builder().id(USER_ID).build();
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(owner).name("이전이름").build();
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusTagUpdateRequest body = new FocusTagUpdateRequest(TAG_ID, "새이름");

        // when
        focusService.updateFocusTag(USER_ID, body);

        // then
        assertThat(tag.getName()).isEqualTo("새이름");
    }

    @Test
    @DisplayName("존재하지 않는 태그 → FocusException(TAG_NOT_FOUND)")
    void updateFocusTagNotFound() {
        // given
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.empty());
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
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(otherOwner).name("이전이름").build();
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
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
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(owner).name("공부").build();
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));

        // when
        focusService.deleteFocusTag(USER_ID, TAG_ID);

        // then: 하드 삭제가 아니라 deletedAt 세팅
        assertThat(tag.getDeletedAt()).isNotNull();
        verify(focusTagRepository, never()).delete(any(FocusTag.class));
    }

    @Test
    @DisplayName("존재하지 않는 태그 → FocusException(TAG_NOT_FOUND)")
    void deleteFocusTagNotFound() {
        // given
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.empty());

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
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(otherOwner).name("공부").build();
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));

        // when & then: FORBIDDEN, delete 미호출
        assertThatThrownBy(() -> focusService.deleteFocusTag(USER_ID, TAG_ID))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusTagRepository, never()).delete(any(FocusTag.class));
    }

    // ── getFocusSessions (커서 페이지네이션) ────────────────────────────────

    private static final Instant FROM = Instant.parse("2026-06-01T00:00:00Z");
    private static final Instant TO = Instant.parse("2026-06-30T23:59:59Z");
    private static final UUID LAST_ID = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

    @Test
    @DisplayName("커서 조회 성공 → 태그 null 포함 매핑 + hasNext/nextCursor(마지막 id)")
    void getFocusSessionsSuccess() {
        User user = User.builder().id(USER_ID).build();
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(user).name("공부").build();
        FocusSession withTag = FocusSession.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000bb"))
                .user(user).focusTag(tag).subject("수학")
                .startedAt(START).endedAt(END)
                .distractionCount(2).totalDistractionSeconds(30).build();
        FocusSession withoutTag = FocusSession.builder()
                .id(LAST_ID)
                .user(user).focusTag(null).subject("영어")
                .startedAt(START).endedAt(END)
                .distractionCount(0).totalDistractionSeconds(0).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        // 첫 페이지(cursor=null) — id DESC 정렬 결과 2건, 다음 페이지 있음
        given(focusSessionRepository.findSessionsByCursor(
                eq(user), any(Instant.class), any(Instant.class), isNull(), any(Pageable.class)))
                .willReturn(new SliceImpl<>(List.of(withTag, withoutTag), PageRequest.of(0, 20), true));

        FocusSessionSliceResponse result = focusService.getFocusSessions(USER_ID, FROM, TO, null, 20);

        assertThat(result.content()).hasSize(2);
        assertThat(result.content().get(0).getFocusTagId()).isEqualTo(TAG_ID);
        assertThat(result.content().get(0).getSubject()).isEqualTo("수학");
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
                .id(LAST_ID).user(user).subject("영어")
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
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(user).name("공부").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        // DailyFocusStat upsert 경로 설정 (신규 insert)
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(any(), any())).willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, "수학", START, END, 2, 30);

        // when
        focusService.saveFocusSession(USER_ID, body);

        // then: 저장 값 검증
        ArgumentCaptor<FocusSession> captor = ArgumentCaptor.forClass(FocusSession.class);
        verify(focusSessionRepository).save(captor.capture());
        FocusSession saved = captor.getValue();
        assertThat(saved.getUser()).isEqualTo(user);
        assertThat(saved.getFocusTag()).isEqualTo(tag);
        assertThat(saved.getSubject()).isEqualTo("수학");
        assertThat(saved.getStartedAt()).isEqualTo(START);
        assertThat(saved.getEndedAt()).isEqualTo(END);
        assertThat(saved.getDistractionCount()).isEqualTo(2);
        assertThat(saved.getTotalDistractionSeconds()).isEqualTo(30);
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
        FocusSessionRequest body = new FocusSessionRequest(null, "영어", START, END, 0, 0);

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
        FocusSessionRequest body = new FocusSessionRequest(null, "영어", START, END, 0, 0);

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
        FocusSessionRequest body = new FocusSessionRequest(null, "영어", null, null, 0, 0);

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
        FocusSessionRequest body = new FocusSessionRequest(null, "영어", END, START, 0, 0);

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
        FocusTag tag = FocusTag.builder().id(TAG_ID).user(other).name("공부").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(focusTagRepository.findByIdAndDeletedAtIsNull(TAG_ID)).willReturn(Optional.of(tag));
        FocusSessionRequest body = new FocusSessionRequest(TAG_ID, "수학", START, END, 2, 30);

        // when & then
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, body))
                .isInstanceOf(FocusException.class)
                .extracting("errorCode")
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }

    // ── DailyFocusStat upsert (T1-T7) ────────────────────────────────────

    /** T1: 신규 날짜 첫 세션 → DailyFocusStat 신규 insert, 집계 정합 검증 */
    @Test
    @DisplayName("T1: 신규 날짜 첫 세션 → DailyFocusStat 신규 insert, totalFocusMinutes/sessionCount/distractionCount 정합")
    void saveFocusStat_newDate_firstSession_createsNewRow() {
        // START=01:00Z, END=02:00Z → 60분, endedAt UTC date = 2026-06-23
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, "공부", START, END, 2, 30);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        DailyFocusStat stat = captor.getValue();
        assertThat(stat.getTotalFocusMinutes()).isEqualTo(60);
        assertThat(stat.getSessionCount()).isEqualTo(1);
        assertThat(stat.getDistractionCount()).isEqualTo(2);
        assertThat(stat.isFocusGoalAchieved()).isFalse();
    }

    /** T2: 같은 날 두 번째 세션 → 기존 row 누적(totalFocusMinutes 합산, sessionCount+1, distractionCount 합산) */
    @Test
    @DisplayName("T2: 같은 날 두 번째 세션 → 기존 row 누적 — totalFocusMinutes/sessionCount/distractionCount 합산")
    void saveFocusStat_sameDay_secondSession_accumulates() {
        // 기존 30분·1세션·1방해 row 존재, 60분 세션 추가 → 90분·2세션·4방해
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusMinutes(30).sessionCount(1).distractionCount(1).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, "독서", START, END, 3, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 업데이트 경로: save() 미호출(더티 체킹), 필드 누적 검증
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        assertThat(existing.getTotalFocusMinutes()).isEqualTo(90);
        assertThat(existing.getSessionCount()).isEqualTo(2);
        assertThat(existing.getDistractionCount()).isEqualTo(4);
    }

    /** T3: UTC 자정 경계 — 23:55 시작 → 00:05 종료 → endedAt UTC date(익일)로 귀속, 시작일 집계 없음 */
    @Test
    @DisplayName("T3: UTC 자정 경계 — endedAt UTC date 기준 익일 집계 귀속, 시작일에는 집계 없음")
    void saveFocusStat_utcMidnightBoundary_endedAtDateAttribution() {
        // 2026-06-22 23:55 UTC 시작 → 2026-06-23 00:05 UTC 종료 = 10분 세션
        // endedAt UTC date = 2026-06-23 → 익일 집계 귀속
        Instant startedAt = Instant.parse("2026-06-22T23:55:00Z");
        Instant endedAt = Instant.parse("2026-06-23T00:05:00Z");
        LocalDate expectedDate = LocalDate.of(2026, 6, 23);
        LocalDate startDate = LocalDate.of(2026, 6, 22);

        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(expectedDate)))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class))).willAnswer(inv -> inv.getArgument(0));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, "운동", startedAt, endedAt, 0, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 익일(expectedDate)로만 집계 귀속
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(expectedDate);
        assertThat(captor.getValue().getTotalFocusMinutes()).isEqualTo(10);
        // 시작일(startDate)로는 조회/집계 없음
        verify(dailyFocusStatRepository, never()).findByUserAndDate(user, startDate);
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
        FocusSessionRequest body = new FocusSessionRequest(null, "공부", START, END, 0, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalFocusMinutes()).isEqualTo(60);
        assertThat(captor.getValue().isFocusGoalAchieved()).isTrue();
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
        FocusSessionRequest body = new FocusSessionRequest(null, "공부", START, END, 0, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isFocusGoalAchieved()).isFalse();
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
        FocusSessionRequest body = new FocusSessionRequest(null, "공부", START, END, 0, 0);

        focusService.saveFocusSession(USER_ID, body);

        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isFocusGoalAchieved()).isFalse();
    }

    /** T7: 방해 횟수 누적 — 두 세션의 distractionCount 합산 정합 검증 */
    @Test
    @DisplayName("T7: 기존 row에 두 번째 세션 distractionCount 누적 → 합산 정합")
    void saveFocusStat_distractionCountAccumulates() {
        // 기존 5방해 row 존재 + 3방해 세션 추가 → 8방해
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusMinutes(30).sessionCount(1).distractionCount(5).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        FocusSessionRequest body = new FocusSessionRequest(null, "수학", START, END, 3, 0);

        focusService.saveFocusSession(USER_ID, body);

        assertThat(existing.getDistractionCount()).isEqualTo(8); // 5 + 3
    }

    /** T8: update 경로 goal 달성 — 기존 30분·focusGoalAchieved=false·goal=60 에서 추가 30분 → 누적 60분 == goal → focusGoalAchieved=true 전이 */
    @Test
    @DisplayName("T8: update 경로 — 기존 30분(미달성) + 30분 세션 = 60분 누적 → focusGoalAchieved=true 전이")
    void saveFocusStat_updatePath_goalAchieved_setsFlagTrue() {
        // 기존 row: 30분·1세션·미달성(false), goal=60
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusMinutes(30).sessionCount(1).distractionCount(0)
                .focusGoalAchieved(false).build();
        // 추가 세션: START=01:00Z ~ 01:30Z → 30분
        Instant end30 = Instant.parse("2026-06-23T01:30:00Z");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));
        FocusSessionRequest body = new FocusSessionRequest(null, "공부", START, end30, 0, 0);

        focusService.saveFocusSession(USER_ID, body);

        // update 경로: save() 미호출, 누적 60분 == goal → focusGoalAchieved=true 전이
        verify(dailyFocusStatRepository, never()).save(any(DailyFocusStat.class));
        assertThat(existing.getTotalFocusMinutes()).isEqualTo(60);
        assertThat(existing.isFocusGoalAchieved()).isTrue();
    }

    /** T9: update 경로 이미 달성(true) → userFocusTimeSettingsRepository 조회 스킵(단방향 플래그) */
    @Test
    @DisplayName("T9: update 경로 — focusGoalAchieved=true 이미 달성 시 goal 조회 없이 스킵")
    void saveFocusStat_updatePath_alreadyAchieved_skipsGoalQuery() {
        // 기존 row: 이미 달성(true) — 추가 세션이 와도 재판정 불필요
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 23))
                .totalFocusMinutes(60).sessionCount(1).distractionCount(0)
                .focusGoalAchieved(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDateForUpdate(eq(user), eq(LocalDate.of(2026, 6, 23))))
                .willReturn(Optional.of(existing));
        FocusSessionRequest body = new FocusSessionRequest(null, "공부", START, END, 0, 0);

        focusService.saveFocusSession(USER_ID, body);

        // 달성 상태 그대로 유지, goal 조회를 위한 findById 미호출
        assertThat(existing.isFocusGoalAchieved()).isTrue();
        verify(userFocusTimeSettingsRepository, never()).findById(any());
    }

    // ── [직접 구현 B] 도메인 엣지케이스 (정책 판단 필요) ───────────────────────
    @Test
    @Disabled("TODO: 직접 구현 — 0초 세션 경계값 정책 결정")
    @DisplayName("세션 종료==시작(0초 세션) → 허용? 거부? 정책 결정 필요")
    void saveFocusSessionZeroDuration() {
        // 배경: 현재 서비스는 endedAt.isBefore(startedAt) 만 막음 → '같을 때'는 통과(저장됨)
        // given: startedAt == endedAt (예: START, START)
        FocusSessionRequest req = new FocusSessionRequest(TAG_ID, "수학", START, START, 0, 0);

        // when & then: 의도한 정책에 맞춰
        //   - 0초 세션을 막아야 한다면: 서비스에 검증 추가 후 IllegalArgumentException 검증
        //   - 허용이 맞다면: verify(focusSessionRepository).save(...) 로 '허용을 명시적으로 보장'
        assertThatThrownBy(() -> focusService.saveFocusSession(USER_ID, req))
                .isInstanceOf(FocusException.class)
                .isEqualTo(FocusErrorCode.FORBIDDEN);
        verify(focusSessionRepository, never()).save(any(FocusSession.class));
    }
}
