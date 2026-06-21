package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.focus.FocusSession;
import com.oneorthree.phone.repository.focus.FocusSessionRepository;
import com.oneorthree.phone.service.dto.focusmode.FocusSessionRequest;
import com.oneorthree.phone.service.dto.focusmode.FocusSessionResponse;
import com.oneorthree.phone.service.dto.focusmode.FocusTagResponse;
import com.oneorthree.phone.service.dto.focusmode.FocusTagSetupRequest;
import com.oneorthree.phone.service.dto.focusmode.FocusTagUpdateRequest;
import com.oneorthree.phone.domain.focus.FocusTag;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.exception.FocusTagNotFoundException;
import com.oneorthree.phone.exception.ForbiddenException;
import com.oneorthree.phone.exception.UserNotFoundException;
import com.oneorthree.phone.repository.focus.FocusTagRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private final FocusTagRepository focusTagRepository;
    private final UserRepository userRepository;
    private final FocusSessionRepository focusSessionRepository;

    public List<FocusTagResponse> getFocusTags(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        return focusTagRepository.findByUser(user)
                .stream()
                .map(tag -> new FocusTagResponse(tag.getId(), tag.getName()))
                .toList();
    }

    @Transactional
    public void setupFocusTag(Long userId, FocusTagSetupRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        focusTagRepository.save(FocusTag.builder()
                .user(user)
                .name(body.name())
                .build());
    }

    @Transactional
    public void updateFocusTag(Long userId, FocusTagUpdateRequest body) {
        FocusTag tag = focusTagRepository.findById(body.tagId())
                .orElseThrow(FocusTagNotFoundException::new);

        if (!tag.getUser().getId().equals(userId)) {
            throw new ForbiddenException();
        }

        tag.updateName(body.name());
    }

    @Transactional
    public void deleteFocusTag(Long userId, Long tagId) {
        FocusTag tag = focusTagRepository.findById(tagId)
                .orElseThrow(FocusTagNotFoundException::new);

        if (!tag.getUser().getId().equals(userId)) {
            throw new ForbiddenException();
        }

        focusTagRepository.delete(tag);
    }

    public List<FocusSessionResponse> getFocusSessions(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

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
    public void saveFocusSession(Long userId, FocusSessionRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        if (body.getStartedAt() == null || body.getEndedAt() == null) {
            throw new IllegalArgumentException("시작/종료 시간은 필수입니다");
        }

        if (body.getEndedAt().isBefore(body.getStartedAt())) {
            throw new IllegalArgumentException("종료 시간이 시작 시간보다 앞설 수 없습니다");
        }

        FocusTag tag = null;
        if (body.getFocusTagId() != null) {
            tag = focusTagRepository.findById(body.getFocusTagId())
                    .orElseThrow(FocusTagNotFoundException::new);

            if (!tag.getUser().getId().equals(userId)) {
                throw new ForbiddenException();
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
