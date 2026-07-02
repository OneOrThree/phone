package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.domain.FocusTag;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.focus.repository.FocusTagRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private static final int MAX_PAGE_SIZE = 100;

    private final FocusTagRepository focusTagRepository;
    private final UserRepository userRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;

    public List<FocusTagResponse> getFocusTags(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return focusTagRepository.findByUserAndDeletedAtIsNull(user)
                .stream()
                .map(tag -> new FocusTagResponse(tag.getId(), tag.getName()))
                .toList();
    }

    @Transactional
    public void setupFocusTag(UUID userId, FocusTagSetupRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        focusTagRepository.save(FocusTag.builder()
                .user(user)
                .name(body.name())
                .build());
    }

    @Transactional
    public void updateFocusTag(UUID userId, FocusTagUpdateRequest body) {
        FocusTag tag = focusTagRepository.findByIdAndDeletedAtIsNull(body.tagId())
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        tag.updateName(body.name());
    }

    @Transactional
    public void deleteFocusTag(UUID userId, UUID tagId) {
        FocusTag tag = focusTagRepository.findByIdAndDeletedAtIsNull(tagId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        tag.softDelete();
    }

    public FocusSessionSliceResponse getFocusSessions(UUID userId, Instant from, Instant to, UUID cursor, int size) {
        if (from == null || to == null || from.isAfter(to)) {
            throw new FocusException(FocusErrorCode.INVALID_DATE_RANGE);
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new FocusException(FocusErrorCode.INVALID_PAGE_REQUEST);
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        Slice<FocusSession> slice = focusSessionRepository
                .findSessionsByCursor(user, from, to, cursor, PageRequest.of(0, size));

        List<FocusSessionResponse> content = slice.getContent().stream()
                .map(session -> new FocusSessionResponse(
                        session.getFocusTag() != null ? session.getFocusTag().getId() : null,
                        session.getSubject(),
                        session.getStartedAt(),
                        session.getEndedAt(),
                        session.getDistractionCount(),
                        session.getTotalDistractionSeconds()
                ))
                .toList();

        // 다음 커서 = 마지막 항목 id(hasNext 일 때만). content 는 id DESC 정렬이라 마지막이 최소 id.
        UUID nextCursor = slice.hasNext() && !slice.getContent().isEmpty()
                ? slice.getContent().get(slice.getContent().size() - 1).getId()
                : null;

        return new FocusSessionSliceResponse(content, size, slice.hasNext(), nextCursor);
    }

    @Transactional
    public void saveFocusSession(UUID userId, FocusSessionRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (body.getStartedAt() == null || body.getEndedAt() == null) {
            throw new IllegalArgumentException("시작/종료 시간은 필수입니다");
        }

        if (body.getEndedAt().isBefore(body.getStartedAt())) {
            throw new IllegalArgumentException("종료 시간이 시작 시간보다 앞설 수 없습니다");
        }

        FocusTag tag = null;
        if (body.getFocusTagId() != null) {
            tag = focusTagRepository.findByIdAndDeletedAtIsNull(body.getFocusTagId())
                    .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

            if (!tag.getUser().getId().equals(userId)) {
                throw new FocusException(FocusErrorCode.FORBIDDEN);
            }
        }

        focusSessionRepository.save(FocusSession.builder()
                .user(user)
                .focusTag(tag)
                .subject(body.getSubject())
                .startedAt(body.getStartedAt())
                .endedAt(body.getEndedAt())
                .distractionCount(body.getDistractionCount())
                .totalDistractionSeconds(body.getTotalDistractionSeconds())
                .build());
        long durationSeconds = Duration.between(body.getStartedAt(), body.getEndedAt()).getSeconds();
        userActivityEventLogger.log(UserActivityEvent.FOCUS_SESSION_COMPLETED,
                Map.of("duration_seconds", durationSeconds,
                        "distraction_count", body.getDistractionCount(),
                        "has_tag", tag != null));

        // ── DailyFocusStat upsert: endedAt UTC date 기준 (user, date) 멱등 누적 ──
        LocalDate statDate = body.getEndedAt().atOffset(ZoneOffset.UTC).toLocalDate();
        // 세션 분 계산: floor (Duration.toMinutes() = 초/60 내림, 별도 반올림 정책 없음)
        int addedMinutes = (int) Duration.between(body.getStartedAt(), body.getEndedAt()).toMinutes();

        // UPDATE-UPDATE lost update 방지(누적 연산): 비관적 쓰기 잠금으로 동시 세션 저장 시 += 누락 차단
        // INSERT-INSERT 동시 삽입은 unique(user_id, date) 제약이 정합성 보장(오염 없음, 실패 건은 클라 재시도)
        Optional<DailyFocusStat> existingStat = dailyFocusStatRepository.findByUserAndDateForUpdate(user, statDate);
        if (existingStat.isPresent()) {
            // 기존 row 누적 (+= 방식) — 더티 체킹으로 반영됨, 별도 save() 불필요
            DailyFocusStat stat = existingStat.get();
            stat.setTotalFocusMinutes(stat.getTotalFocusMinutes() + addedMinutes);
            stat.setSessionCount(stat.getSessionCount() + 1);
            stat.setDistractionCount(stat.getDistractionCount() + body.getDistractionCount());
            // focusGoalAchieved: 이미 달성(true)이면 재판정 불필요 — 플래그 단방향이므로 조기 스킵
            if (!stat.isFocusGoalAchieved()) {
                int goal = userFocusTimeSettingsRepository.findById(userId)
                        .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
                if (goal > 0 && stat.getTotalFocusMinutes() >= goal) {
                    stat.setFocusGoalAchieved(true);
                }
            }
        } else {
            // INSERT 경로: focusGoalAchieved 판정을 builder에 포함시켜 INSERT 쿼리 1회로 줄임
            // UserFocusTimeSettings row 없거나 goal=0이면 플래그 false 유지
            int goal = userFocusTimeSettingsRepository.findById(userId)
                    .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
            dailyFocusStatRepository.save(DailyFocusStat.builder()
                    .user(user)
                    .date(statDate)
                    .totalFocusMinutes(addedMinutes)
                    .sessionCount(1)
                    .distractionCount(body.getDistractionCount())
                    .focusGoalAchieved(goal > 0 && addedMinutes >= goal)
                    .build());
        }
    }
}
