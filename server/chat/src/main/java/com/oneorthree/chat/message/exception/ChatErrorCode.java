package com.oneorthree.chat.message.exception;

import com.oneorthree.chat.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

/**
 * 채팅이 «의도적으로» 거절하는 이유들. 상수 이름이 앱과의 계약이다.
 *
 * <p>이 서비스의 두 규칙이 여기 각각 코드 하나로 서 있다 —
 * {@link #NOT_A_MEMBER}(같은 섬 안에서만) 와 {@link #FOCUS_IN_PROGRESS}(집중 중엔 못 들어온다).
 * 앱은 이 둘을 반드시 다르게 그려야 한다: 앞은 «들어갈 수 없는 방», 뒤는 «지금은 안 되는 시간»이다.
 */
@Getter
@RequiredArgsConstructor
public enum ChatErrorCode implements ErrorCode {

    /**
     * 그 섬(그룹)의 활성 멤버가 아니다 — <b>탈퇴·강퇴·애초에 남의 섬·존재하지 않는 섬이 전부 이 코드 하나로
     * 합쳐진다.</b> 일부러 합친 것이다: 갈라 주면 임의의 groupId 를 넣어 보는 것만으로 «그런 그룹이
     * 있는가»를 알아낼 수 있어 비공개 그룹의 존재가 샌다. 404 가 아니라 403 인 이유도 같다.
     */
    NOT_A_MEMBER(HttpStatus.FORBIDDEN, "이 섬의 멤버가 아닙니다."),

    /**
     * 집중 세션이 진행 중이라 채팅에 들어올 수 없다.
     *
     * <p>403 이 아니라 <b>409</b> 인 것은 «권한이 없다»가 아니라 «지금 상태와 충돌한다»이기 때문이다 —
     * 같은 사람이 같은 방에, 집중을 끝내기만 하면 들어올 수 있다. 앱은 이 코드를 재로그인이나 권한
     * 오류로 처리하면 안 되고, 「집중이 끝나면 이어서 볼 수 있어요」로 그려야 한다.
     *
     * <p>판정 근거는 Redis 프레즌스 리스이고, 그 리스는 사본이다 — 리스 쓰기가 실패해 키가 없으면
     * 집중 중인데도 통과한다. 이 규칙은 스스로를 위한 규칙이라 그 방향의 실패를 수용한다
     * ({@code FocusPresenceReader} 참고).
     */
    FOCUS_IN_PROGRESS(HttpStatus.CONFLICT, "집중 중에는 채팅을 이용할 수 없습니다."),

    /** 본문이 비었거나 공백뿐이다. 공백만 있는 메시지를 저장하면 방에 빈 말풍선이 남는다. */
    BLANK_CONTENT(HttpStatus.BAD_REQUEST, "메시지를 입력해 주세요."),

    /** 본문이 상한(2000자)을 넘었다. 상한은 DB 컬럼 길이가 아니라 이 규칙이 정한다. */
    CONTENT_TOO_LONG(HttpStatus.BAD_REQUEST, "메시지가 너무 깁니다."),

    /**
     * 커서가 쓸 수 없는 값이다 — 두 경우가 여기로 합쳐진다.
     *
     * <ul>
     *   <li>히스토리 커서가 UUID 로 파싱되지 않음. 조용히 «처음부터»로 떨어뜨리면 무한 스크롤이
     *       맨 위에서 같은 페이지를 영원히 다시 받는다</li>
     *   <li>읽음 커서가 <b>그 섬의 메시지가 아님</b>. 검증 없이 저장하면 임의의 큰 UUID 한 번으로
     *       그 방의 앞으로 올 메시지까지 전부 읽은 것으로 숨길 수 있고, 커서는 뒤로 가지 않으므로
     *       스스로 풀리지도 않는다</li>
     * </ul>
     */
    INVALID_CURSOR(HttpStatus.BAD_REQUEST, "잘못된 커서입니다.");

    private final HttpStatus status;
    private final String message;
}
