package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupMember;
import com.oneorthree.phone.domain.group.GroupMemberRole;
import com.oneorthree.phone.domain.group.MissionType;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.GroupErrorCode;
import com.oneorthree.phone.exception.GroupException;
import com.oneorthree.phone.repository.group.GroupMemberRepository;
import com.oneorthree.phone.repository.group.GroupRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.group.CreateGroupRequest;
import com.oneorthree.phone.service.dto.group.CreateGroupResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @Transactional
    public CreateGroupResponse createGroup(Long userId, CreateGroupRequest request) {
        // 1) 게스트 검증
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GUEST_FORBIDDEN));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        // 2) 미션 타입별 필수값 검증
        if (request.getMissionType() == MissionType.DURATION && request.getDurationMinutes() == null) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (request.getMissionType() == MissionType.TIME_WINDOW
                && (request.getWindowStart() == null || request.getWindowEnd() == null)) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }

        // 3) 유니크 코드 생성 (충돌 시 만료 여부 확인 후 재사용 or 재시도)
        String uniqueCode = generateUniqueCode();

        // 4) 비밀번호 BCrypt 해시
        String hashedPassword = null;
        if (request.getPassword() != null) {
            hashedPassword = passwordEncoder.encode(request.getPassword());
        }

        // 5) Group 저장
        Group group = groupRepository.save(Group.builder()
                .name(request.getName())
                .password(hashedPassword)
                .description(request.getDescription())
                .maxMembers(request.getMaxMembers() != null ? request.getMaxMembers() : 10)
                .missionType(request.getMissionType())
                .missionCategory(request.getMissionCategory())
                .durationMinutes(request.getDurationMinutes())
                .windowStart(request.getWindowStart())
                .windowEnd(request.getWindowEnd())
                .hostId(userId)
                .code(uniqueCode)
                .codeExpiresAt(Instant.now().plus(24, ChronoUnit.HOURS))
                .build());

        // GroupMember(OWNER) 저장
        groupMemberRepository.save(GroupMember.builder()
                .user(user)
                .group(group)
                .role(GroupMemberRole.OWNER)
                .build());

        // 6) 응답 반환
        return new CreateGroupResponse(group.getId(), uniqueCode);
    }

    private String generateUniqueCode() {
        StringBuilder sb = new StringBuilder(8);
        for (int i = 0; i < 10; i++) {
            sb.setLength(0);
            for (int j = 0; j < 8; j++) {
                sb.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
            }
            String code = sb.toString();

            if (!groupRepository.existsByCode(code)) {
                return code;
            }

            // 충돌: 만료된 코드면 NULL로 정리하고 재사용
            groupRepository.findByCode(code).ifPresent(existing -> {
                if (existing.getCodeExpiresAt() != null
                        && existing.getCodeExpiresAt().isBefore(Instant.now())) {
                    existing.expireCode();
                }
            });
        }
        throw new GroupException(GroupErrorCode.CODE_GENERATION_FAILED);
    }
}
