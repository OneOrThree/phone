package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * FocusLiveInfoLookup 단위 테스트 (GROMO-822).
 * 당일 집중분·진행중 여부·시작시각·태그명을 userId→FocusLiveInfo 맵으로 배치 도출한다.
 */
@ExtendWith(MockitoExtension.class)
class FocusLiveInfoLookupTest {

    @InjectMocks
    private FocusLiveInfoLookup focusLiveInfoLookup;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private FocusSessionRepository focusSessionRepository;

    private static final LocalDate DATE = LocalDate.of(2026, 7, 3);

    @Test
    @DisplayName("집중 중 — 당일 집중분 + isFocusing=true + 시작시각 + 태그명 매핑")
    void liveInfo_focusing_mapsAllFields() {
        UUID uid = UUID.randomUUID();
        User u = user(uid);
        Instant start = Instant.parse("2026-07-03T01:00:00Z");
        given(dailyFocusStatRepository.findByUserIdInAndDate(List.of(uid), DATE))
                .willReturn(List.of(stat(u, 42 * 60)));
        given(focusSessionRepository.findLiveSessionsByUserIdIn(eq(List.of(uid)), any()))
                .willReturn(List.of(session(u, start, tag("전공 공부"))));

        Map<UUID, FocusLiveInfo> result = focusLiveInfoLookup.liveInfoByUserId(List.of(uid), DATE);

        assertThat(result).containsKey(uid);
        FocusLiveInfo info = result.get(uid);
        assertThat(info.focusTimeMinutes()).isEqualTo(42);
        assertThat(info.isFocusing()).isTrue();
        assertThat(info.focusStartedAt()).isEqualTo(start);
        assertThat(info.focusTagName()).isEqualTo("전공 공부");
    }

    @Test
    @DisplayName("미집중 — 당일 집계만 있고 진행중 세션 없으면 분>0·isFocusing=false·시작시각/태그 null")
    void liveInfo_notFocusing_minutesOnly() {
        UUID uid = UUID.randomUUID();
        User u = user(uid);
        given(dailyFocusStatRepository.findByUserIdInAndDate(List.of(uid), DATE))
                .willReturn(List.of(stat(u, 30 * 60)));
        given(focusSessionRepository.findLiveSessionsByUserIdIn(eq(List.of(uid)), any()))
                .willReturn(List.of());

        Map<UUID, FocusLiveInfo> result = focusLiveInfoLookup.liveInfoByUserId(List.of(uid), DATE);

        FocusLiveInfo info = result.get(uid);
        assertThat(info.focusTimeMinutes()).isEqualTo(30);
        assertThat(info.isFocusing()).isFalse();
        assertThat(info.focusStartedAt()).isNull();
        assertThat(info.focusTagName()).isNull();
    }

    @Test
    @DisplayName("태그 없는 진행중 세션 — isFocusing=true 지만 focusTagName=null, 당일 집계 없으면 분 0")
    void liveInfo_focusingWithoutTag_tagNameNull() {
        UUID uid = UUID.randomUUID();
        User u = user(uid);
        Instant start = Instant.parse("2026-07-03T02:00:00Z");
        given(dailyFocusStatRepository.findByUserIdInAndDate(List.of(uid), DATE))
                .willReturn(List.of());
        given(focusSessionRepository.findLiveSessionsByUserIdIn(eq(List.of(uid)), any()))
                .willReturn(List.of(session(u, start, null)));

        Map<UUID, FocusLiveInfo> result = focusLiveInfoLookup.liveInfoByUserId(List.of(uid), DATE);

        FocusLiveInfo info = result.get(uid);
        assertThat(info.isFocusing()).isTrue();
        assertThat(info.focusStartedAt()).isEqualTo(start);
        assertThat(info.focusTagName()).isNull();
        assertThat(info.focusTimeMinutes()).isZero();
    }

    @Test
    @DisplayName("중복 라이브 세션 — startedAt DESC 정렬 전제로 첫(최신) 세션의 시작시각·태그명 채택(결정성)")
    void liveInfo_multipleLiveSessions_picksLatest() {
        UUID uid = UUID.randomUUID();
        User u = user(uid);
        Instant later = Instant.parse("2026-07-03T05:00:00Z");
        Instant earlier = Instant.parse("2026-07-03T01:00:00Z");
        given(dailyFocusStatRepository.findByUserIdInAndDate(List.of(uid), DATE))
                .willReturn(List.of());
        // 쿼리가 startedAt DESC 로 정렬해 최신이 먼저 온다 — 헬퍼는 첫 번째(최신)를 유지해야 한다.
        given(focusSessionRepository.findLiveSessionsByUserIdIn(eq(List.of(uid)), any()))
                .willReturn(List.of(session(u, later, tag("최신")), session(u, earlier, tag("이전"))));

        Map<UUID, FocusLiveInfo> result = focusLiveInfoLookup.liveInfoByUserId(List.of(uid), DATE);

        FocusLiveInfo info = result.get(uid);
        assertThat(info.focusStartedAt()).isEqualTo(later);
        assertThat(info.focusTagName()).isEqualTo("최신");
    }

    @Test
    @DisplayName("빈 입력 → 빈 맵이고 repository 미호출")
    void liveInfo_empty_noRepositoryCall() {
        Map<UUID, FocusLiveInfo> result = focusLiveInfoLookup.liveInfoByUserId(List.of(), DATE);

        assertThat(result).isEmpty();
        verifyNoInteractions(dailyFocusStatRepository, focusSessionRepository);
    }

    private User user(UUID id) {
        return User.builder().id(id).nickname("u").build();
    }

    private DailyFocusStat stat(User u, int seconds) {
        return DailyFocusStat.builder().user(u).date(DATE).totalFocusSeconds(seconds).build();
    }

    private UserFocusTag tag(String name) {
        return UserFocusTag.builder().defaultTag(DefaultTag.builder().name(name).build()).build();
    }

    private FocusSession session(User u, Instant startedAt, UserFocusTag focusTag) {
        return FocusSession.builder().user(u).startedAt(startedAt).focusTag(focusTag).build();
    }
}
