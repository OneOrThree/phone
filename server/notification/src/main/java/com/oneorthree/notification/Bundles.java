package com.oneorthree.notification;

import java.util.Map;

/**
 * 묶음 축의 <b>정본</b> — 어떤 kind 가 (유저 × 그룹 × 슬롯) 한 건으로 접히는지, 그 묶음을 어떤 순서로
 * 모아 어떤 문구로 렌더하는지를 한 곳에 둔다.
 *
 * <p>이 표가 갈라지면 조용히 회귀한다. 후보 수집({@link DispatchService})만 묶고 렌더({@link Renderer})가
 * 모르면 「N건」 문구가 없는 kind 가 템플릿을 못 찾고, 반대로 렌더만 알고 수집이 모르면 <b>같은 알림이
 * 대상 수만큼</b> 나간다 — 챌린지 종료가 정확히 그 회귀였다(허용목록에 종료 kind 가 없었다).
 */
final class Bundles {

    /** 결과 슬롯의 폭 — 15분 버킷이 «닫힌» 뒤에만 flush 한다. */
    static final int RESULT_SLOT_SECONDS = 900;

    /**
     * 묶음 한 종류.
     *
     * @param id                collapse 키에 실리는 축 이름 — 같은 그룹·슬롯이라도 축이 다르면 별개 묶음이다
     * @param predicate         같은 묶음에 드는 kind 의 SQL 조건(상수 — 외부 입력이 섞이지 않는다)
     * @param order             묶음 안의 정렬 — 첫 행이 곧 «대표»다
     * @param waitsForSlotClose 슬롯이 닫힐 때까지 기다리는 묶음인지(결과 버킷만 해당)
     * @param rendersAsFirst    묶어도 문구는 대표 1건 그대로인지 — 구 경로가 (유저 × 그룹) 한 건을
     *                          개수 없는 같은 문구로 보내던 종료 알림이 여기 해당한다
     */
    record Family(String id, String predicate, String order, boolean waitsForSlotClose, boolean rendersAsFirst) {
    }

    private static final Family RESULT = new Family("result",
            "kind IN ('BET_RESULT','BET_VOID_REFUND')", "subject_id,id", true, false);
    private static final Family OPEN = new Family("open",
            "kind='CHALLENGE_SESSION_OPEN'", "subject_id,id", false, false);
    // 종료 알림의 대표는 «가장 먼저 만들어진 챌린지»(그룹 대표 미션 관례)다. 발송부가 사건마다
    // 그 대표를 «명시»해 보내므로 여기서 수신 순서로 추측하지 않는다 — relay 재전달·처리 경합에서
    // 수신 순서는 생성 순서와 갈라진다. 대표를 못 실은 사건(이관분)만 created_at 로 물러선다.
    private static final String END_ORDER =
            "(payload->>'challengeId') IS DISTINCT FROM (payload->>'bundleRepresentative'),created_at,id";
    private static final Family WINDOW_END = new Family("CHALLENGE_WINDOW_END",
            "kind='CHALLENGE_WINDOW_END'", END_ORDER, false, true);
    private static final Family DURATION_END = new Family("CHALLENGE_ENDED",
            "kind='CHALLENGE_ENDED'", END_ORDER, false, true);

    // 창형과 일 목표형은 문구가 다르다(「결과」 대 「어제 목표 달성 결과」). 구 경로의 dedup 축도
    // pushType 별이었으므로 한 묶음으로 섞지 않는다.
    private static final Map<String, Family> FAMILIES = Map.of(
            "BET_RESULT", RESULT,
            "BET_VOID_REFUND", RESULT,
            "CHALLENGE_SESSION_OPEN", OPEN,
            "CHALLENGE_WINDOW_END", WINDOW_END,
            "CHALLENGE_ENDED", DURATION_END);

    private Bundles() {
    }

    /**
     * @param kind 알림 종류
     * @return 그 종류가 속한 묶음 — 묶지 않는 종류면 {@code null}
     */
    static Family of(Object kind) {
        return kind == null ? null : FAMILIES.get(kind.toString());
    }
}
