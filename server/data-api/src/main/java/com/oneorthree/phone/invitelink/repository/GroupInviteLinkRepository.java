package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * 초대 링크 저장소. 조회 축이 둘이다 — 발급 쪽은 (그룹, 초대자), 랜딩·매치 쪽은 slug 다.
 * 두 축 모두 DB 유니크 제약이 받쳐 주므로 {@code Optional} 은 "없음"만 뜻하고 "여럿 중 하나"가 아니다.
 */
public interface GroupInviteLinkRepository extends JpaRepository<GroupInviteLink, UUID> {

    /**
     * 멱등 발급의 조회 경로 — (그룹, 초대자)당 링크는 1개다.
     *
     * @param groupId 초대 대상 그룹
     * @param inviterId 링크를 발급한 멤버. 클릭 보상의 귀속 대상이라 초대자별로 링크가 갈린다
     * @return 이미 발급된 링크, 없으면 empty. 동시 발급이 UNIQUE 제약을 때렸을 때
     *         "상대가 먼저 만든 링크"를 되찾는 데도 쓰인다
     */
    Optional<GroupInviteLink> findByGroupIdAndInviterId(UUID groupId, UUID inviterId);

    /**
     * 랜딩·매치의 조회 경로.
     *
     * @param slug 외부에서 그대로 들어온 링크 식별자 — 미인증 트래픽이 값을 정한다
     * @return 링크, 없으면 empty. 호출부는 empty 를 404 가 아니라 "만료"로 접는다
     */
    Optional<GroupInviteLink> findBySlug(String slug);

    /**
     * slug 생성 시 충돌 확인용.
     *
     * @param slug 새로 뽑은 후보 문자열
     * @return true 면 이미 쓰이는 값이라 다시 뽑아야 한다. 확인과 INSERT 사이에 경쟁이 가능하므로
     *         최종 방어는 이 검사가 아니라 DB 유니크 제약이다
     */
    boolean existsBySlug(String slug);
}
