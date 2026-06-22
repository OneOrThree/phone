package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionResponse;
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
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private final FocusTagRepository focusTagRepository;
    private final UserRepository userRepository;
    private final FocusSessionRepository focusSessionRepository;

    public List<FocusTagResponse> getFocusTags(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return focusTagRepository.findByUser(user)
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
        FocusTag tag = focusTagRepository.findById(body.tagId())
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        tag.updateName(body.name());
    }

    @Transactional
    public void deleteFocusTag(UUID userId, UUID tagId) {
        FocusTag tag = focusTagRepository.findById(tagId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.TAG_NOT_FOUND));

        if (!tag.getUser().getId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }

        focusTagRepository.delete(tag);
    }

    public List<FocusSessionResponse> getFocusSessions(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return focusSessionRepository.findByUserWithTag(user)
                .stream()
                .map(session -> new FocusSessionResponse(
                        session.getFocusTag() != null ? session.getFocusTag().getId() : null,
                        session.getSubject(),
                        session.getStartedAt(),
                        session.getEndedAt(),
                        session.getDistractionCount(),
                        session.getTotalDistractionSeconds()
                ))
                .toList();
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
            tag = focusTagRepository.findById(body.getFocusTagId())
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
    }
}
