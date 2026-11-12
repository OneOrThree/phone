package com.oneorthree.phone.letter.service;

import com.oneorthree.phone.letter.repository.LetterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

/** 계정 잠금을 확보한 탈퇴 트랜잭션에서 송수신 편지를 파기한다. */
@Service
@RequiredArgsConstructor
public class LetterErasureService {
    private final LetterRepository letters;

    @Transactional(propagation = Propagation.MANDATORY)
    public void eraseWithdrawnUser(UUID userId) {
        letters.eraseAllOfUser(userId);
    }
}
