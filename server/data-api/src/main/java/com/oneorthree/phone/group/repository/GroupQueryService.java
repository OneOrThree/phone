package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/** 섬·멤버십 조회. 잠금 선택과 대상 부재 판정을 한곳에서 유지한다. */
@Service
@RequiredArgsConstructor
public class GroupQueryService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;

    /**
     * 그룹 단건 — 락 없음.
     *
     * @param groupId 조회 대상
     * @return 그룹. <b>종료·삭제 상태는 보지 않는다</b> — 그 판정은 호출측 몫이다
     * @throws GroupException 없으면 {@link GroupErrorCode#GROUP_NOT_FOUND}
     */
    public Group getGroup(UUID groupId) {
        return groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
    }

    /**
     * 그룹 단건 — <b>배타 락</b>. 이 트랜잭션이 그룹 행을 변경할 때만 쓴다.
     *
     * <p>다른 트랜잭션이 같은 행을 쥐고 있으면 <b>대기</b>한다(건너뛰지 않는다).
     * {@code readOnly} 트랜잭션에서는 쓸 수 없다.
     *
     * @param groupId 조회 대상
     * @return 잠긴 그룹. 상태·삭제를 보지 않는 것은 락 없는 조회와 같다
     * @throws GroupException 없으면 {@link GroupErrorCode#GROUP_NOT_FOUND}
     */
    public Group getGroupForUpdate(UUID groupId) {
        return groupRepository.findByIdForUpdate(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GROUP_NOT_FOUND));
    }

    /**
     * 그 유저가 그 그룹의 멤버여야 하는 자리 — 아니면 거절한다.
     *
     * <p><b>역할(방장 여부)은 보지 않는다.</b> 방장 전용 동작은 이걸로 멤버십을 얻은 뒤
     * service 가 역할을 따로 검사한다 — 그게 비즈니스 규칙이라 조회 계층에 넣으면
     * "왜 이 API 는 방장만 되는가"가 코드에서 사라진다.
     *
     * @param user  요청자
     * @param group 대상 그룹
     * @return <b>활성 멤버십</b> 1건. 탈퇴·강퇴 행({@code is_left = true})은 쿼리에서 이미 걸러지므로
     *     호출측이 {@code isLeft} 를 다시 볼 필요가 없다. 락이 없어 조회 직후 탈퇴가 커밋될 수 있으니,
     *     돈이 걸린 경로는 잠금판({@link GroupMemberRepository#findActiveByUserIdAndGroupIdForShare})을
     *     직접 써야 한다 — 그 락 등급은 이 계층이 감추지 않는다
     * @throws GroupException 활성 멤버가 아니면 {@link GroupErrorCode#MEMBER_ONLY}. "가입한 적 없음"과
     *     "나갔음"을 구분하지 않는다
     */
    public GroupMember getMembership(User user, Group group) {
        return groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
    }

    /**
     * 멤버십이 있는지 없는지만 알려준다 — <b>부재가 정상이거나, 존재 자체가 거절 사유</b>인 자리.
     *
     * <p>{@link #getMembership} 로는 표현할 수 없는 자리가 셋이다 — 존재가 거절 사유인 곳
     * ({@code ALREADY_MEMBER}), 부재를 {@code MEMBER_ONLY} 가 아닌 다른 코드로 거절하는 곳
     * ({@code NOT_OWNER} · 지목한 대상이라 {@code NOT_FOUND}), 그리고 부재가 정상이라 boolean 으로만
     * 쓰는 곳. 예외 의미를 호출부에 남겨 두는 것이 목적이므로 이 메서드는 아무것도 던지지 않는다.
     *
     * <p>재가입 판정("강퇴된 적 있는가")은 이걸로 못 한다 — 강퇴 행은 {@code is_left = true} 라
     * 여기서 빈 값으로 나온다. 그 판정은 {@link GroupMemberRepository#findAnyByUserAndGroup} 을
     * 직접 쓴다(이 계층에 없는 유일한 멤버십 조회다).
     *
     * @param user  대상 유저
     * @param group 대상 그룹
     * @return 활성 멤버십 1건. 없거나 이미 나갔으면 빈 값
     */
    public Optional<GroupMember> findMembership(User user, Group group) {
        return groupMemberRepository.findByUserAndGroup(user, group);
    }

    /**
     * 그룹 단건 — 락 없음, <b>부재가 정상</b>.
     *
     * <p>{@link #getGroup} 과 달리 던지지 않는다. 초대 링크 랜딩처럼 "그룹이 사라졌으면 만료와 같게
     * 다룬다"는 자리가 쓴다 — 종료·삭제 판정은 <b>호출부가 이어서</b> 한다(그건 비즈니스 규칙이다).
     *
     * @param groupId 조회 대상
     * @return 그룹. 없으면 빈 값
     */
    public Optional<Group> findGroup(UUID groupId) {
        return groupRepository.findById(groupId);
    }

}
