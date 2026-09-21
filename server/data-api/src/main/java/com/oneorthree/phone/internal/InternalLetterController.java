package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.LetterSendRequest;
import com.oneorthree.phone.internal.dto.LetterSliceView;
import com.oneorthree.phone.internal.dto.LetterView;
import com.oneorthree.phone.internal.service.InternalLetterService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 편지 4종의 <b>내부 표면</b> (GROMO-1933 발송·목록·상세 + GROMO-2002 닫기) — 공개 {@code /letters…} 는
 * Business 의 {@code LetterController} 가 열고 여기는 그 위임만 받는다. nginx 위성 include 가 무접두
 * {@code /letters} 를 Business 로 보내므로 data-api 가 그 경로를 매핑해도 요청이 닿지 않는다.
 *
 * <p>경로 규칙은 B26 의 「사용자 축은 {@code /internal/users/{userId}/…}」다 — {@code InternalAuthFilter}
 * 가 그 접두어에서 경로의 userId 와 {@code X-User-Id} 의 일치를 강제하므로 {@code @LoginUser} 대신 경로
 * 변수로 주체를 받는다(GROMO-1764·1894 선례).
 *
 * <p>LLD §1.15 는 이 컨트롤러를 {@code letter} 패키지에 두자고 했지만 그 전제(「도메인 전용 내부 표면은
 * 도메인 패키지가 갖는다」)는 이미 깨져 있다 — 집중 세션·친구·호스트 이전의 내부 표면이 전부 이
 * 패키지(L10)에 있다. 선례를 따른다.
 *
 * <p>응답은 {@code {"data": …}} 로 감싸지 않는다(봉투는 Business 몫). 빈 목록도 봉투 한 겹으로 내려간다 —
 * 빈 본문을 주면 Business 의 {@code InternalHttpClient} 가 계약 불일치(502)로 올린다.
 */
@RestController
@RequestMapping("/internal/users/{userId}")
@RequiredArgsConstructor
public class InternalLetterController {

    private final InternalLetterService internalLetterService;

    /** 편지 보내기 (LLD §1.12). 수신자의 섬·시설은 조회하지 않는다 — 발송은 우체통과 무관하다. */
    @PostMapping("/letters")
    @ResponseStatus(HttpStatus.CREATED)
    public LetterView send(@PathVariable UUID userId, @Valid @RequestBody LetterSendRequest body) {
        return internalLetterService.send(userId, body);
    }

    /** 편지함 목록 (LLD §1.13·§1.15). 세 파라미터 모두 선택 — 화면 조각이 파라미터 없이 부른다. */
    @GetMapping("/letters")
    public LetterSliceView mailbox(@PathVariable UUID userId,
                                   @RequestParam(required = false) String type,
                                   @RequestParam(required = false) UUID cursor,
                                   @RequestParam(required = false) Integer size) {
        return internalLetterService.list(userId, type, cursor, size);
    }

    /** 편지 상세 (LLD §1.14). 수신자의 첫 조회면 읽음 시각이 박히지만 행은 남는다 — 지우는 것은 닫기다. */
    @GetMapping("/letters/{letterId}")
    public LetterView detail(@PathVariable UUID userId, @PathVariable UUID letterId) {
        return internalLetterService.detail(userId, letterId);
    }

    /**
     * 편지 닫기 (GROMO-2002) — 수신자만. 양쪽 목록·상세에서 함께 사라진다.
     * 본문이 없으므로 204 다(Business 의 공개 봉투 규칙이 200 {@code {"data": null}} 로 접는다).
     */
    @DeleteMapping("/letters/{letterId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(@PathVariable UUID userId, @PathVariable UUID letterId) {
        internalLetterService.close(userId, letterId);
    }
}
