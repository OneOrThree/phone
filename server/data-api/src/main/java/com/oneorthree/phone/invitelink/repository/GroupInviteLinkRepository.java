package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

    /**
     * 세대가 어긋난 링크를 새 슬러그·세대로 <b>조건부</b> 교체한다 (GROMO-1760).
     *
     * <p>{@code issuance_epoch <> :epoch} 조건이 동시 재발급을 한 번으로 수렴시킨다 — 늦게 온 쪽은
     * 앞선 커밋의 행 잠금을 기다린 뒤 조건이 거짓이 되어 0행을 갱신하고, 이긴 쪽 슬러그를
     * {@link #findSlugById} 로 읽어 돌려준다. 무조건 UPDATE 면 마지막 쓰기가 조용히 이겨, 진 쪽이
     * 응답한 슬러그가 DB 에 없는 값이 된다.
     *
     * <p>트랜잭션은 섬 초대 발급 서비스가 연다(규약 §4).
     *
     * @return 1 = 이 호출이 교체했다, 0 = 이미 같은 세대로 교체돼 있다
     */
    @Modifying
    @Query("UPDATE GroupInviteLink l SET l.slug = :slug, l.issuanceEpoch = :epoch "
            + "WHERE l.id = :id AND l.issuanceEpoch <> :epoch")
    int reissueIfStale(@Param("id") UUID id, @Param("slug") String slug, @Param("epoch") long epoch);

    /** 현재 슬러그를 DB 에서 직접 읽는다 — 영속성 컨텍스트의 낡은 엔티티를 거치지 않는다. */
    @Query("SELECT l.slug FROM GroupInviteLink l WHERE l.id = :id")
    String findSlugById(@Param("id") UUID id);

    /**
     * 탈퇴자가 발급한 링크의 발급자 연결을 끊는다 (GROMO-1801 · 계정 LLD §4 · policy A10 · V65).
     *
     * <p>발급자가 없는 초대는 폐기로 취급한다. 다른 사용자의 가입 이력이 참조할 수 있으므로 행은 보존한다.
     *
     * @param userId 탈퇴하는 유저
     * @return 바뀐 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE GroupInviteLink l SET l.inviterId = null WHERE l.inviterId = :userId")
    int detachInviter(@Param("userId") UUID userId);
}
