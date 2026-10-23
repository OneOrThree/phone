package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;

/** 친구 라이브 표시는 현행 세션 상세·순수 집중 구간과 주제를 사용한다. */
@ExtendWith(MockitoExtension.class)
class FocusLiveInfoLookupTest {
    @InjectMocks private FocusLiveInfoLookup lookup;
    @Mock private DailyFocusStatRepository stats;
    @Mock private FocusSessionRepository sessions;
    @Mock private FocusSessionDetailRepository details;
    @Mock private FocusSessionIntervalRepository intervals;

    @Test
    void currentSessionUsesSubjectAndActiveInterval() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        Instant started = Instant.now().minusSeconds(120);
        User user = User.builder().id(userId).build();
        given(sessions.findLiveSessionsByUserIdIn(eq(List.of(userId)), any()))
                .willReturn(List.of(FocusSession.builder().id(sessionId).user(user).startedAt(started).build()));
        given(details.findAllById(List.of(sessionId))).willReturn(List.of(FocusSessionDetail.builder()
                .sessionId(sessionId).lifecycle(FocusSessionLifecycle.ACTIVE).subject("독서").build()));
        given(intervals.findBySessionIdInOrderByOrdinalAsc(List.of(sessionId)))
                .willReturn(List.of(FocusSessionInterval.builder().sessionId(sessionId)
                        .kind(FocusIntervalKind.ACTIVE).startedAt(started).build()));

        var info = lookup.liveInfoByUserId(List.of(userId), LocalDate.now()).get(userId);

        assertThat(info.isFocusing()).isTrue();
        assertThat(info.focusTagName()).isEqualTo("독서");
        assertThat(info.focusStartedAt()).isBetween(started, started.plusSeconds(1));
    }

    @Test
    void markerWithoutCurrentDetailDoesNotShowAsFocusing() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        User user = User.builder().id(userId).build();
        LocalDate today = LocalDate.now();
        given(stats.findByUserIdInAndDate(List.of(userId), today)).willReturn(List.of(
                DailyFocusStat.builder().user(user).date(today).totalFocusSeconds(1800).build()));
        given(sessions.findLiveSessionsByUserIdIn(eq(List.of(userId)), any())).willReturn(List.of(
                FocusSession.builder().id(sessionId).user(user).startedAt(Instant.now()).build()));

        var info = lookup.liveInfoByUserId(List.of(userId), today).get(userId);

        assertThat(info.isFocusing()).isFalse();
        assertThat(info.focusTimeMinutes()).isEqualTo(30);
        assertThat(info.focusTagName()).isNull();
    }

    @Test
    void emptyInputDoesNotQuery() {
        assertThat(lookup.liveInfoByUserId(List.of(), LocalDate.now())).isEmpty();
        verifyNoInteractions(stats, sessions, details, intervals);
    }
}
