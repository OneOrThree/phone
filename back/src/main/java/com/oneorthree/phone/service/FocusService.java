package com.oneorthree.phone.service;

import com.oneorthree.phone.service.dto.FocusTagSetupRequest;
import com.oneorthree.phone.service.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.domain.focus.FocusTag;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.FocusTagNotFoundException;
import com.oneorthree.phone.exception.ForbiddenException;
import com.oneorthree.phone.exception.UserNotFoundException;
import com.oneorthree.phone.repository.focus.FocusTagRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusService {

    private final FocusTagRepository focusTagRepository;
    private final UserRepository userRepository;

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
}
