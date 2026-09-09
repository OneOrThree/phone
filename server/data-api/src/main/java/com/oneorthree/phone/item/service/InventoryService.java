package com.oneorthree.phone.item.service;

import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.item.repository.ItemQueryService;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 유저가 어떤 아이템을 가졌는지를 다룬다.
 *
 * <p>보유에는 수량이 없다 — 같은 아이템은 있거나 없거나 둘 중 하나라, 지급을 여러 번 해도
 * 상태가 더 늘지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
@Slf4j
public class InventoryService {
    private final UserQueryService userQueryService;
    private final ItemQueryService itemQueryService;
    private final UserItemRepository userItemRepository;

    /**
     * 내 인벤토리 조회
     * todo 조회 성능 개선
     *
     * @param userId 조회 대상. 탈퇴했거나 없는 유저면 NOT_FOUND(404)
     * @return 보유 목록(페이지네이션 없음). 착용 여부는 담기지 않으니 장비 조회로 따로 봐야 한다
     */
    public List<UserItemResponse> getInventory(UUID userId) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        // 예외도 변경 경로와 동일하게 UserException(NOT_FOUND, 404)으로 통일.
        User user = userQueryService.getCaller(userId);

        return userItemRepository.findByUser(user)
                .stream()
                .map(UserItemResponse::from)
                .toList();
    }

    /**
     * 아이템 지급 (테스트용)
     * todo 쓰기 성능 개선 및 로직 개선
     *
     * @param userId 받을 유저. 탈퇴했거나 없는 유저면 NOT_FOUND(404)
     * @param itemId 넣어 줄 아이템. 카탈로그에 없으면 404
     */
    @Transactional
    public void grantItem(UUID userId, UUID itemId) {
        requireActiveUser(userId);
        itemQueryService.getItem(itemId);

        userItemRepository.grantIfNotExists(userId, itemId);
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 아이템 지급처럼 users 행은 <b>읽기만
     * 하고</b> user_items 를 insert 하는 변경 트랜잭션의 요청자 로드. 결과를 버리는 존재 확인이던
     * 기존 findById 를 락 조회로 바꿔 계정 탈퇴(유저 행 배타 락)와 직렬화한다 — 탈퇴가 먼저
     * 커밋되면 READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404). 예외는 기존
     * EntityNotFoundException(핸들러 미등록 → 500) 대신 다른 서비스와 동일한
     * UserException(NOT_FOUND, 404)으로 통일한다(GROMO-1237).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private void requireActiveUser(UUID userId) {
        // 지급 대상은 요청 본문이 지정한다(관리자/시스템 용도) — 요청자가 아니라 «지목한 유저»라
        // 부재는 TARGET_USER_NOT_FOUND 다(GROMO-1725, claude 리뷰). getCaller 로 두면 없는 대상에
        // 지급하려던 관리자에게 «다시 로그인하라»고 답한다.
        userQueryService.getTargetForShare(userId);
    }
}
