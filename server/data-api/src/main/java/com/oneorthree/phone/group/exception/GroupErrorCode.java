package com.oneorthree.phone.group.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 그룹 도메인의 실패 코드 — HTTP 상태와 응답 문구를 한 값에 묶어 둔다.
 *
 * <p>{@link GroupException} 이 이 값 하나로 응답을 결정하므로, 새 실패 상황은 예외 클래스가 아니라
 * 여기에 상수를 더해 표현한다. 문구는 응답 바디에 그대로 실리는 사용자 문장이다.
 */
@Getter
public enum GroupErrorCode implements ErrorCode {

    REALTIME_NOT_READY(HttpStatus.SERVICE_UNAVAILABLE, "방장 위임을 아직 사용할 수 없습니다."),
    CANNOT_TRANSFER_SELF(HttpStatus.CONFLICT, "자기 자신에게 방장을 위임할 수 없습니다."),
    // 섬 관리 명령 4종(정보 수정·가입 승인/거절·강퇴·나가기, GROMO-1802)의 기능 게이트 — 위임 게이트
    // REALTIME_NOT_READY 와 같은 503 이지만 막는 스위치가 달라 하나만 먼저 여는 날 구분해야 한다.
    ISLAND_MANAGEMENT_NOT_READY(HttpStatus.SERVICE_UNAVAILABLE, "섬 관리 기능을 아직 사용할 수 없습니다."),
    // 섬 정보 수정의 빈 이름(GROMO-1802, 섬 관리 LLD §2) — 형식 오류(400)가 아니라 값 범위 위반 422 다.
    // 요청 본문 파서 안에서 던지면 읽기 실패 400 으로 접히므로 서비스가 이 코드로 거절한다.
    ISLAND_NAME_BLANK(HttpStatus.UNPROCESSABLE_ENTITY, "섬 이름을 입력해 주세요."),
    // 권한
    NOT_OWNER(HttpStatus.FORBIDDEN, "그룹장만 수행할 수 있습니다."),
    MEMBER_ONLY(HttpStatus.FORBIDDEN, "그룹원만 조회할 수 있습니다."),
    // 우체통 미완공(GROMO-1775) — Business 가 공개 FACILITY_LOCKED 로 옮긴다. 1759 의 OBSERVATORY_LOCKED 와 같은 결.
    // 지금은 발급 경로가 «닫혀» 있다: 건설 도메인 미구현이라 InternalIslandMailboxService.requireMailboxUnlocked 가
    // 통과시킨다. 시설 테이블이 생기면 그 한 곳에서 던진다.
    MAILBOX_LOCKED(HttpStatus.FORBIDDEN, "우체통을 지으면 편지를 주고받을 수 있어요"),
    // 섬 검색 진입 가드(GROMO-1759 · 섬 소속 LLD §3.2) — 현재 섬의 전망대가 열려야 이름 검색을
    // 쓸 수 있다. 첫 소속 탐색은 가드가 없는 discover 를 쓰므로 이 코드로 접히지 않는다.
    OBSERVATORY_LOCKED(HttpStatus.FORBIDDEN, "전망대를 지으면 다른 섬을 찾아볼 수 있어요"),
    // 게시판 미완공(GROMO-1771) — 섬 공지·댓글 게이트. Business 가 공개 FACILITY_LOCKED 로 옮긴다.
    // construction.facility-gates.enforce 가 꺼져 있으면(기본) 나가지 않는다.
    BOARD_LOCKED(HttpStatus.FORBIDDEN, "게시판을 지으면 공지를 볼 수 있어요"),
    // 도서관 미완공(GROMO-1895) — 도서관 물고기 장(주민별 누적 획득) 게이트. Business 가 공개 FACILITY_LOCKED 로 옮긴다.
    // construction.facility-gates.enforce 가 꺼져 있으면(기본) 나가지 않는다.
    LIBRARY_LOCKED(HttpStatus.FORBIDDEN, "도서관을 지으면 물고기 장을 볼 수 있어요"),
    // 섬 게시판 쓰기 4종 게이트(GROMO-1771) — 댓글 삭제·탈퇴 처리(BQ02)와 본문·댓글 상한(BQ03)이 결정되기 전
    // 쓰기를 열지 않는다(island-board 정책 「writer 출시 금지」). 기본 OFF, island-board.writes-enabled 로 켠다.
    // REALTIME_NOT_READY 와 같은 503 이지만 막는 사유가 달라 한 코드로 접지 않는다.
    NOTICE_WRITE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "공지·댓글 작성은 아직 사용할 수 없습니다."),
    // BQ03 결정 전 임시 상한(island-board.notice-body-max-length / comment-max-length)을 넘었다.
    // 필드가 달라 앱이 가리킬 입력이 다르므로 두 코드로 나눈다.
    NOTICE_BODY_TOO_LONG(HttpStatus.UNPROCESSABLE_ENTITY, "공지 본문이 너무 길어요"),
    NOTICE_COMMENT_TOO_LONG(HttpStatus.UNPROCESSABLE_ENTITY, "댓글이 너무 길어요"),

    // 잘못된 입력 및 요청
    // 내기 히스토리 페이지네이션(GROMO-1207) — FocusErrorCode.INVALID_PAGE_REQUEST 와 같은 성격.
    INVALID_PAGE_REQUEST(HttpStatus.BAD_REQUEST, "유효하지 않은 페이지 요청입니다."),
    // 창 사용분 보고(GROMO-1407·N34) — measuredAt 이 서버 시각 +2분을 넘는다(기기 시계 앞섬).
    // 미래 시각을 받아 주면 이후의 정상 보고가 전부 "오래된 값"으로 버려져 낮은 사용분이 굳는다.
    // 참가자 스코프 조회(GROMO-1415) — /me/bet-sessions 의 status 필터는 OPEN 만 지원한다.
    // 404 세 갈래 (GROMO-1725) — 앱이 code 문자열로 분기하므로 «무엇이 없는가»를 코드로 가른다.
    // 종전엔 셋 다 NOT_FOUND 였고, 앱 그룹 화면 17곳이 유저 부재까지 «그룹이 사라짐»으로 해석했다.
    // NOT_FOUND 는 그룹 **안의** 것(공지·멤버십) 부재에만 남긴다. 앱은 신구를 병기해 받는다(1726) —
    // 그래서 배포 순서는 앱 → 서버다. 이름 변경 금지.
    GROUP_NOT_FOUND(HttpStatus.NOT_FOUND, "원하는 그룹을 찾을 수 없습니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "원하는 그룹을 찾을 수 없습니다."),

    // 비즈니스 로직상 에러,
    ALREADY_MEMBER(HttpStatus.CONFLICT, "이미 참여 중인 그룹입니다."),
    ROOM_FULL(HttpStatus.CONFLICT, "그룹 정원이 가득 찼습니다."),
    HOST_WITHDRAW(HttpStatus.BAD_REQUEST, "방장 위임 후 탈퇴할 수 있습니다."),
    MAX_MEMBERS_TOO_SMALL(HttpStatus.BAD_REQUEST, "그룹에 참여중인 인원이 더 많습니다."),
    // A-0/A-3 소프트삭제·강퇴 — 앱이 응답의 code 문자열로 분기할 수 있으니 이름 신중히.
    // (대상 멤버 없음은 기존 NOT_FOUND 재사용 — transferOwner 와 동일 패턴)
    KICKED_CANNOT_REJOIN(HttpStatus.FORBIDDEN, "강퇴된 그룹에는 다시 참여할 수 없어요"),
    CANNOT_KICK_SELF(HttpStatus.BAD_REQUEST, "자기 자신은 내보낼 수 없어요"),
    // 앱이 응답의 code 문자열(GROUP_LIMIT_EXCEEDED)로 분기한다 — 이름 변경 금지.
    // 문구는 소속 섬 상한 3 (GROMO-2260) 기준이다.
    GROUP_LIMIT_EXCEEDED(HttpStatus.CONFLICT, "소속 섬이 가득 찼어요 (3/3). 섬을 하나 나가면 새로 가입할 수 있어요"),
    // 즉시 이동은 가 본 섬으로만 된다 (GROMO-2260) — 망원경에서 가입만 하고 아직 항해하지 않은 소속 섬.
    ISLAND_NOT_ARRIVED(HttpStatus.FORBIDDEN, "아직 가 본 적 없는 섬이에요. 망원경에서 항해해 주세요"),
    NOTICE_FORBIDDEN(HttpStatus.FORBIDDEN, "공지 작성/수정/삭제 권한이 없습니다."),
    // 섬 게시판 댓글 삭제 전용(GROMO-2136, 2026-09-25 결정) — 작성자 본인 또는 방장만. 메시지가 가리키는
    // 대상이 달라 NOTICE_FORBIDDEN 과 코드를 나눈다(NOTICE_BODY_TOO_LONG/NOTICE_COMMENT_TOO_LONG 과 같은 결).
    NOTICE_COMMENT_FORBIDDEN(HttpStatus.FORBIDDEN, "댓글 삭제 권한이 없습니다."),

    // 섬 가입 요청 (GROMO-1760 · 섬 소속 LLD §3.7~§3.9) — 앱이 응답의 code 문자열로 분기한다.
    // 본인 것이 아닌 요청도 이 코드다 — 타인 요청의 존재를 응답으로 구분해 주지 않는다(§3.8).
    JOIN_REQUEST_NOT_FOUND(HttpStatus.NOT_FOUND, "가입 요청을 찾을 수 없어요"),
    // 승인/거절/취소/섬 종결 중 하나가 먼저 닫은 요청 — 열린 것만 전이할 수 있다.
    JOIN_REQUEST_TERMINAL(HttpStatus.CONFLICT, "이미 처리된 가입 요청이에요"),
    // 비공개 섬 — 유효한 초대 코드 없이는 가입·신청 둘 다 안 된다(§3.7).
    INVITATION_REQUIRED(HttpStatus.FORBIDDEN, "초대가 필요한 섬이에요"),
    // IM-D04 미결 — 비밀번호가 걸린 기존 그룹은 새 가입 경로로 열지 않는다. password 입력이 없는
    // 이 API 로 잠긴 방에 들이면 «기존 잠금을 무시»가 되므로, 그 분기를 활성화하지 않고 거절한다.
    ISLAND_JOIN_UNAVAILABLE(HttpStatus.FORBIDDEN, "이 섬은 아직 이 방법으로 가입할 수 없어요"),

    // 동시성 — 낙관락(@Version: Group 정원) 충돌의 전역 폴백(GlobalExceptionHandler).
    // 트랜잭션 전체가 롤백된 일시 충돌이라 클라이언트가 재시도하면 풀린다. 구앱은 이 코드를 모르므로
    // 공통 재시도 문구로 강하한다 — 의미가 같아 안전하다.
    CONCURRENT_UPDATE(HttpStatus.CONFLICT, "잠시 후 다시 시도해주세요"),

    // 섬 방명록(GROMO-2262) — 방문 1회 = 유저·섬·KST 하루(결정 N6). 앱이 이 코드로 «오늘은 이미 남겼어요» 를 띄운다.
    GUESTBOOK_ALREADY_WRITTEN_TODAY(HttpStatus.CONFLICT, "오늘은 이미 방명록을 남겼어요"),

    // 고양이 잡지 홍보 신청(GROMO-2267) — 섬장이 같은 KST 날 두 번째로 신청했다. 앱이 이 코드로 «오늘은 이미 신청했어요» 를
    // 띄우므로 일반 STATE_CONFLICT 로 접지 않는다. 잔액 부족은 건설·상점과 같은 INSUFFICIENT_FUNDS(409)다.
    PROMOTION_ALREADY_REQUESTED_TODAY(HttpStatus.CONFLICT, "오늘은 이미 잡지 홍보를 신청했어요");

    private final HttpStatus status;
    private final String message;

    GroupErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
