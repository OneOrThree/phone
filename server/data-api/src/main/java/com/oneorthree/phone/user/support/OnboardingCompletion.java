package com.oneorthree.phone.user.support;

import com.oneorthree.phone.user.repository.domain.User;

/**
 * 「온보딩이 끝났는가」 판정 — <b>한 곳</b>이다 (계정 LLD §2.2 Q04).
 *
 * <h2>왜 함수 하나여야 하는가</h2>
 * 이 값은 로그인 201 응답과 {@code GET /me}, 그리고 {@code PATCH /me} 의 전이 판정(변경 전·후 비교로
 * {@code user.onboarded} 를 낼지 정한다)에 <b>모두</b> 쓰인다. 셋이 각자 판정하면 로그인은 「완료」
 * 인데 {@code /me} 는 「미완료」인 상태가 생기고, 전이 사건이 두 번 나가거나 아예 안 나간다.
 * LLD 가 「Q04 판정 함수를 하나로 공유」라고 못 박은 이유다.
 *
 * <h2>⚠️ 현재 판정식은 확정된 제품 정책이 아니다</h2>
 * 정책 Q03(색상 6종의 자산 ID)·Q04(기존 사용자 승계)가 <b>미답</b>이다. 권고안은 「유효 name 과
 * catColor 를 «모두» 저장하면 완료」인데, {@code catColor} 는 Q03 이 정해지기 전이라 컬럼조차 없다.
 * 그래서 지금 확인할 수 있는 절반(nickname)만 본다.
 *
 * <p>LLD 는 「이름이 있으면 완료 등의 기본값으로 <b>확정</b>하지 않는다」고 금지한다 — 이 파일은 그
 * 금지를 어기는 것이 아니라 <b>확정을 한 곳에 가둬 둔 것</b>이다. Q03/Q04 가 답을 주면 이 메서드
 * 하나만 고치면 되고, 호출부는 손대지 않는다. 판정을 호출부로 흘려보내면 그때 전부를 찾아다녀야 한다.
 */
public final class OnboardingCompletion {

    private OnboardingCompletion() {
    }

    /**
     * @param user 활성 사용자
     * @return 온보딩 완료 여부. Q03/Q04 확정 전까지는 nickname 보유 여부다
     */
    public static boolean isComplete(User user) {
        // TODO(GROMO-1756 Q03/Q04): catColor 자산 ID 확정 후 「name AND catColor」로 좁힌다.
        String nickname = user.getNickname();
        return nickname != null && !nickname.isBlank();
    }
}
