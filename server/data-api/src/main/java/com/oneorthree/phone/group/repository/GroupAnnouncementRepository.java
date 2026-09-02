package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 그룹 공지 조회. 삭제는 하드 딜리트({@code delete})라 두 조회 모두 {@code deleted_at} 을 보지 않는다 —
 * 컬럼은 스키마에만 남아 있고 채워지지 않는다.
 *
 * <p>모든 조회가 {@link Group} 을 조건에 끼워 넣는다: 공지 id 만으로 찾으면 다른 그룹의 공지를 남의 그룹
 * 경로에서 수정·삭제할 수 있기 때문이다(소속 검증을 쿼리가 대신 진다).
 */
public interface GroupAnnouncementRepository extends JpaRepository<GroupAnnouncement, UUID> {

    /**
     * 그룹 공지 목록 — 최신순. 페이징이 없어 그룹의 공지를 전부 싣는다(공지 수가 적다는 전제).
     *
     * @param group 조회 대상 그룹 — 소속이 아닌 공지는 애초에 담기지 않는다
     * @return 작성 시각 내림차순 공지 전량. 공지가 하나도 없으면 빈 리스트(그룹이 없다는 뜻이 아니다)
     */
    List<GroupAnnouncement> findByGroupOrderByCreatedAtDesc(Group group);

    /**
     * 수정·삭제 대상 공지를 소속과 함께 집어 온다.
     *
     * @param id 공지 id
     * @param group 이 공지가 속해야 하는 그룹 — 불일치면 존재해도 empty 를 준다(타 그룹 공지 조작 차단)
     * @return 해당 그룹의 공지. empty 는 "없음"과 "남의 그룹 것"을 구분하지 않는다 — 호출측은 둘 다
     *     {@code NOT_FOUND} 로 접어 소속 여부가 응답으로 새지 않게 한다
     */
    Optional<GroupAnnouncement> findByIdAndGroup(UUID id, Group group);
}
