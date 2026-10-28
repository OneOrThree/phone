package com.oneorthree.phone.user.support;

import com.oneorthree.phone.user.repository.domain.User;

/**
 * 「온보딩이 끝났는가」 판정 — <b>한 곳</b>이다 (계정 LLD §2.2 Q04).
 *
 * <h2>왜 함수 하나여야 하는가</h2>
 * 이 값은 로그인 201 응답과 {@code GET /me}, 그리고 모든 프로필 writer 의 전이 판정(변경 전·후 비교로
 * {@code user.onboarded} 를 낼지 정한다)에 <b>모두</b> 쓰인다. 셋이 각자 판정하면 로그인은 「완료」
 * 인데 {@code /me} 는 「미완료」인 상태가 생기고, 전이 사건이 두 번 나가거나 아예 안 나간다.
 *
 * <h2>판정식 — Q03/Q04 2026-09-19 권장안 승인</h2>
 * 유효 이름(nickname)과 고양이 색({@code catColor})을 <b>모두</b> 저장했으면 완료다. 기존 {@code isNewUser} 는
 * 완료 여부가 아니라 매핑하지 않는다. 색이 없는 기존 행은 이름이 있어도 미완료이고 온보딩에서 색을 고른다 —
 * A24 로 1.x 데이터는 이관하지 않아(2.0 은 빈 상태로 시작) 승계 대상이 사실상 없다.
 */
public final class OnboardingCompletion {

    private OnboardingCompletion() {
    }

    /**
     * @param user 활성 사용자
     * @return 이름과 고양이 색을 모두 가졌으면 true
     */
    public static boolean isComplete(User user) {
        String nickname = user.getNickname();
        return nickname != null && !nickname.isBlank() && user.getCatColor() != null;
    }
}
