package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.LetterResponses.LetterDetailView;
import com.oneorthree.business.api.dto.LetterResponses.LetterPageView;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.dto.LetterSlice;
import com.oneorthree.business.upstream.data.dto.LetterView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 편지 3종의 위임 (GROMO-1933, friend-letter LLD §1.12~1.15). 판정은 전부 Data 의
 * {@code InternalLetterService} 가 한다 — Business 는 주체를 AT 에서만 꺼내 전달하고 도메인 실패를
 * 공개 오류 표로 옮긴다.
 *
 * <p>게이트 정책은 Data 안에만 있다 — 발송은 우체통을 묻지 않고, 받은함·상세는 {@code LETTER_MAILBOX_LOCKED}
 * (403)을 공개 {@code FACILITY_LOCKED} 로 옮긴다(재영님 확정 2026-09-18). 여기서 같은 조건을 다시
 * 검사하면 두 곳의 판정이 갈라진다.
 *
 * <p>(상태, 코드) 쌍이 정확히 맞을 때만 옮기고 원인 구분은 {@code field} 로 남긴다 — 등록되지 않은 판정은
 * 그대로 올려 502 가 되게 둔다(GROMO-1894 선례).
 */
@Service
@RequiredArgsConstructor
public class LetterUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("SELF_LETTER", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "receiverId")),
            Map.entry("LETTER_CONTENT_BLANK", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            Map.entry("LETTER_CONTENT_OUT_OF_RANGE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "content")),
            Map.entry("INVALID_PAGE_REQUEST", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "size")),
            Map.entry("INVALID_MAILBOX_TYPE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "type")),
            Map.entry("TARGET_USER_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "receiverId")),
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("LETTER_RECIPIENT_NOT_FRIEND", new PublicFailure(ApiErrorCode.NOT_FOUND, "receiverId")),
            Map.entry("LETTER_MAILBOX_LOCKED", new PublicFailure(ApiErrorCode.FACILITY_LOCKED, null)),
            Map.entry("NOT_LETTER_PARTICIPANT", new PublicFailure(ApiErrorCode.FORBIDDEN, "letterId")),
            // GROMO-2002 닫기는 수신자만 — 발신자의 시도는 「참여자가 아님」과 상태가 같고 사유만 다르다.
            Map.entry("NOT_LETTER_RECEIVER", new PublicFailure(ApiErrorCode.FORBIDDEN, "letterId")),
            Map.entry("LETTER_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "letterId")));

    private final DataFriendClient data;

    /** 편지 보내기 (LLD §1.12). 수신자의 섬·시설은 어느 쪽도 묻지 않는다 — 발송은 우체통과 무관하다. */
    public LetterDetailView send(AccessTokenClaims claims, UUID receiverId, String content, Deadline deadline) {
        LetterView view = relay(() -> data.sendLetter(claims.userId(), receiverId, content, deadline));
        if (view == null) {
            throw new UpstreamContractMismatchException("편지 발송 응답이 없습니다");
        }
        return LetterDetailView.from(view);
    }

    /** 편지함 목록 (LLD §1.13). 빈 페이지도 봉투 한 겹이다 — 봉투가 아예 없으면 계약 불일치다. */
    public LetterPageView letters(AccessTokenClaims claims, String type, String cursor, String size,
            Deadline deadline) {
        LetterSlice slice = relay(() -> data.fetchLetters(claims.userId(), type, cursor, size, deadline));
        if (slice == null) {
            throw new UpstreamContractMismatchException("편지함 응답이 없습니다");
        }
        return LetterPageView.from(slice);
    }

    /** 편지 상세 (LLD §1.14). 수신자의 첫 조회는 읽음을 박는다 — 행은 지워지지 않는다. */
    public LetterDetailView letter(AccessTokenClaims claims, UUID letterId, Deadline deadline) {
        LetterView view = relay(() -> data.fetchLetter(claims.userId(), letterId, deadline));
        if (view == null) {
            throw new UpstreamContractMismatchException("편지 응답이 없습니다");
        }
        return LetterDetailView.from(view);
    }

    /**
     * 편지 닫기 (GROMO-2002). 성공 응답에 본문이 없다 — 상류 204 를 그대로 삼키고 공개 표면이
     * {@code {"data": null}} 로 접는다. 「이미 닫힘」은 상류가 404 {@code LETTER_NOT_FOUND} 로 내고
     * 여기서 공개 {@code NOT_FOUND}(field=letterId)가 된다.
     */
    public void close(AccessTokenClaims claims, UUID letterId, Deadline deadline) {
        relay(() -> {
            data.closeLetter(claims.userId(), letterId, deadline);
            return null;
        });
    }

    private <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
    }

    private RuntimeException mapped(UpstreamDomainException error) {
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}
