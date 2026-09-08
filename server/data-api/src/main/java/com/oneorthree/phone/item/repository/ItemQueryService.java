package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.repository.domain.Item;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 아이템을 id 로 조회하는 경로를 접는다 (GROMO-1655). 규약은
 * {@code docs/conventions/backend-layering.md} §3.
 *
 * <h2>이 계층은 지금 잘못된 예외를 던진다 — 알고 그대로 뒀다</h2>
 * {@link #getItem} 은 {@link EntityNotFoundException} 을 던지는데, 이건
 * <b>저장소 전체에서 여기 하나뿐인 raw 예외</b>다. 다른 도메인은 전부
 * {@code <Domain>Exception(<Domain>ErrorCode)} 를 던지고 {@code GlobalExceptionHandler} 가 받는다.
 *
 * <p>문제는 그 핸들러가 잡는 19종에 {@code EntityNotFoundException} 이 <b>없다</b>는 것이다.
 * {@code jakarta.persistence.EntityNotFoundException} 에는 {@code @ResponseStatus} 도 없으므로,
 * 없는 {@code itemId} 로 장착·지급을 요청하면 <b>404 가 아니라 500 이 나간다</b>. {@code itemId} 는
 * 클라이언트 입력이라 도달 가능한 경로다.
 *
 * <p>GROMO-1237 이 같은 두 메서드의 <b>유저 조회</b>만 {@code UserException(NOT_FOUND)} 로 통일하고
 * 아이템 조회는 빠뜨렸다 — 절반만 끝난 통일이다. 고치는 것은 <b>GROMO-895</b>(Item 전용 예외 신설)
 * 이고, 여기서 고치면 500 → 404 로 응답이 바뀌어 GROMO-1655 의 "동작 변경 0" 전제가 깨진다.
 * 그래서 <b>이관만 하고 예외는 그대로 보존</b>했다. 이제 고칠 자리가 이 한 줄이다.
 *
 * <p>{@code item} 에는 {@code exception/} 패키지 자체가 없다.
 *
 * <p><b>트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여한다.
 */
@Service
@RequiredArgsConstructor
public class ItemQueryService {

    private final ItemRepository itemRepository;

    /**
     * 아이템 단건 — 락 없음.
     *
     * @param itemId 조회 대상
     * @return 아이템
     * @throws EntityNotFoundException 없으면. <b>전역 핸들러가 안 잡아 500 으로 나간다</b> —
     *     의도가 아니라 GROMO-895 미완의 결과다(클래스 Javadoc 참조)
     */
    public Item getItem(UUID itemId) {
        return itemRepository.findById(itemId)
                .orElseThrow(() -> new EntityNotFoundException("아이템을 찾을 수 없습니다."));
    }
}
