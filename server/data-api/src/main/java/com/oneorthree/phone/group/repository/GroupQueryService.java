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

/**
 * 그룹·멤버십을 id 로 조회하는 진입점 (GROMO-1655). 규약은
 * {@code docs/conventions/backend-layering.md} §3.
 *
 * <p>종전엔 group service 12개가 {@code groupRepository}·{@code groupMemberRepository} 를 직접 들고
 * 같은 조회를 43번 되풀이했다. 그중 그룹 조회 23건은 전부 같은 예외를 던져 접기 쉬웠지만,
 * 멤버십 조회 24건은 <b>같은 쿼리가 일곱 가지 뜻</b>으로 쓰이고 있었다 — "멤버여야 한다"(18) ·
 * "방장이어야 한다"(2) · "이미 멤버면 안 된다"(1) · "강퇴된 적 있으면 안 된다"(1) 등.
 *
 * <p>그래서 <b>조회만 접고 판정은 service 에 남긴다.</b> 역할·강퇴 여부는 조회 결과에 대한
 * 비즈니스 규칙이지 영속성 관심사가 아니다. 이 클래스가 주는 건 두 가지뿐이다 —
 * "멤버십이 있어야 한다"({@link #requireMember})와 "있는지 없는지 보고 내가 판단하겠다"
 * ({@link #findMembership}).
 *
 * <p><b>트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여한다.
 */
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
     * @throws GroupException 없으면 {@link GroupErrorCode#NOT_FOUND}
     */
    public Group getGroup(UUID groupId) {
        return groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
    }

    /**
     * 그룹 단건 — <b>배타 락</b>. 이 트랜잭션이 그룹 행을 변경할 때만 쓴다.
     *
     * <p>다른 트랜잭션이 같은 행을 쥐고 있으면 <b>대기</b>한다(건너뛰지 않는다).
     * {@code readOnly} 트랜잭션에서는 쓸 수 없다.
     *
     * @param groupId 조회 대상
     * @return 잠긴 그룹. 상태·삭제를 보지 않는 것은 락 없는 조회와 같다
     * @throws GroupException 없으면 {@link GroupErrorCode#NOT_FOUND}
     */
    public Group getGroupForUpdate(UUID groupId) {
        return groupRepository.findByIdForUpdate(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
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
     * @return 멤버십 행. <b>탈퇴·강퇴 이력이 있는 행도 그대로 나온다</b> — 그 판정은 호출측 몫이다
     * @throws GroupException 멤버가 아니면 {@link GroupErrorCode#MEMBER_ONLY}
     */
    public GroupMember requireMember(User user, Group group) {
        return groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
    }

    /**
     * 멤버십이 있는지 없는지만 알려준다 — <b>부재가 정상이거나, 존재 자체가 거절 사유</b>인 자리.
     *
     * <p>예: 재참여는 "이미 멤버면 거절"(존재가 거절 사유)이고 "강퇴 이력이 있으면 거절"
     * (존재하되 상태로 판정)이다. 둘 다 {@link #requireMember} 로는 표현할 수 없다.
     *
     * @param user  대상 유저
     * @param group 대상 그룹
     * @return 멤버십 행. 없으면 빈 값
     */
    public Optional<GroupMember> findMembership(User user, Group group) {
        return groupMemberRepository.findByUserAndGroup(user, group);
    }
}
