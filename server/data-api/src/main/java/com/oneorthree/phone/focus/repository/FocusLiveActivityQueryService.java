package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class FocusLiveActivityQueryService {
    private final FocusSessionDetailRepository details;

    public FocusSessionDetail requireForUpdate(UUID sessionId) {
        return details.findBySessionIdForUpdate(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
    }
}
