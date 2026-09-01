package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 유저가 채택한 집중 태그({@code user_focus_tags}) — 이름 자체는 {@code default_tags} 마스터가 들고 있고
 * 여기는 "누가 어떤 마스터를 쓰는가"의 연결 행이다. 세션은 이 행을 참조하므로 태그를 지워도 과거 세션이
 * 깨지지 않도록 <b>소프트 딜리트</b>({@code deletedAt})를 쓴다 — 그래서 거의 모든 조회에
 * {@code deletedAt IS NULL} 이 붙는다. 이름 변경(rename)도 삭제가 아니라 '옛 행 소프트삭제 + 새 행 채택'
 * 이라, 과거 세션은 {@code FocusSessionRepository#repointFocusTag} 로 새 행에 재연결된다.
 */
public interface UserFocusTagRepository extends JpaRepository<UserFocusTag, UUID> {

    /**
     * 소프트 딜리트 — 활성(삭제되지 않은) 채택 태그만 조회.
     * 목록 응답이 tag.getDefaultTag().getName() 을 읽으므로 JOIN FETCH 로 N+1 방지 (PR #170 리뷰).
     *
     * @param user 태그 주인
     * @return 이름까지 페치된 활성 채택 태그. 소프트삭제된 옛 태그는 빠지고, 정렬은 지정하지 않는다
     */
    @Query("SELECT ut FROM UserFocusTag ut JOIN FETCH ut.defaultTag "
            + "WHERE ut.user = :user AND ut.deletedAt IS NULL")
    List<UserFocusTag> findByUserAndDeletedAtIsNull(@Param("user") User user);

    /**
     * 단건 조회 — 소프트삭제된 태그는 없는 것으로 취급한다.
     *
     * <p>소유 검사는 하지 <b>않는다</b>. 호출측이 반환된 태그의 user 를 요청자와 대조해 403 을 내야 한다.
     *
     * @param id 조회할 채택 태그 id(클라 입력일 수 있다)
     * @return 활성 채택 태그. 없거나 이미 삭제됐으면 빈 값
     */
    Optional<UserFocusTag> findByIdAndDeletedAtIsNull(UUID id);

    /**
     * 여러 유저의 활성 채택 태그를 한 번에 조회 (GROMO-1565, BotSimulator 가 봇 190명분을 매 tick 읽는다).
     * defaultTag 를 fetch 하지 않는 이유: 호출측이 태그 id 만 쓰고 이름을 읽지 않는다.
     * ORDER BY ut.id — 스케줄 생성이 이 순서에 의존하므로(과목 인덱스) 조회마다 흔들리면 안 된다.
     *
     * @param userIds 조회 대상 유저 id. 비어 있으면 빈 목록
     * @return 여러 유저의 활성 태그가 한 목록에 섞여 id 오름차순으로 나온다 — 유저별 그룹핑은 호출측 몫이다.
     *         defaultTag 는 페치하지 않으므로 <b>이름을 읽으면 N+1 이 난다</b>
     */
    @Query("SELECT ut FROM UserFocusTag ut "
            + "WHERE ut.user.id IN :userIds AND ut.deletedAt IS NULL ORDER BY ut.id")
    List<UserFocusTag> findActiveByUserIdIn(@Param("userIds") Collection<UUID> userIds);

    /**
     * 중복 채택 방지 — (user, defaultTag) 활성 채택 존재 여부 확인
     *
     * @param user       채택 주체
     * @param defaultTag 채택하려는 이름 마스터
     * @return 이미 채택 중이면 그 행(재사용 대상). 소프트삭제된 과거 채택은 잡히지 않아 새로 채택된다
     */
    Optional<UserFocusTag> findByUserAndDefaultTagAndDeletedAtIsNull(User user, DefaultTag defaultTag);
}
