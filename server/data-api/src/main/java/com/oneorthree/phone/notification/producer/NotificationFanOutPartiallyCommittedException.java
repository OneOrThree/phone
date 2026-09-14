package com.oneorthree.phone.notification.producer;

import java.time.Instant;

/**
 * 배치의 일부 조각이 이미 커밋된 뒤 잠금 충돌이 소진됐다 — <b>재판정하면 안 되는</b> 실패다 (GROMO-893).
 *
 * <p>이 예외의 원인 사슬에는 {@code 40001}·{@code 40P01} 이 그대로 있다(진단용). 그래도 배치 재시도는 이 타입을 먼저
 * 보고 다시 돌지 않는다. 새 스냅샷으로 다시 판정하면 이미 적힌 사용자에게 다른 종류의 알림이 같은 슬롯에 한 번 더
 * 적힐 수 있기 때문이다.
 *
 * <p>대신 원래 슬롯의 재생 좌표({@code job}·{@code slot})를 싣는다. 재생 역시 새로 판정하므로, 재생할지는 커밋된
 * 조각을 확인한 운영자가 정한다.
 */
public class NotificationFanOutPartiallyCommittedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final int committedChunks;
    private final String sqlState;
    private final String replayJob;
    private final Instant replaySlot;

    /**
     * @param committedChunks 이 배치에서 이미 커밋된 조각 수
     * @param sqlState        소진된 잠금 충돌
     * @param cause           마지막 실패
     */
    public NotificationFanOutPartiallyCommittedException(int committedChunks, String sqlState, Throwable cause) {
        this(committedChunks, sqlState, null, null, cause);
    }

    private NotificationFanOutPartiallyCommittedException(int committedChunks, String sqlState, String replayJob,
                                                          Instant replaySlot, Throwable cause) {
        super(message(committedChunks, sqlState, replayJob, replaySlot), cause);
        this.committedChunks = committedChunks;
        this.sqlState = sqlState;
        this.replayJob = replayJob;
        this.replaySlot = replaySlot;
    }

    /**
     * @param job  ShedLock 이름
     * @param slot 원래 슬롯
     * @return 재생 좌표를 실은 같은 실패
     */
    public NotificationFanOutPartiallyCommittedException withReplayCoordinates(String job, Instant slot) {
        return new NotificationFanOutPartiallyCommittedException(committedChunks, sqlState, job, slot, getCause());
    }

    /** @return 이미 커밋된 조각 수 */
    public int getCommittedChunks() {
        return committedChunks;
    }

    /** @return 소진된 잠금 충돌 SQLSTATE */
    public String getSqlState() {
        return sqlState;
    }

    /** @return 재생할 ShedLock 이름. 배치 재시도 밖에서 났으면 {@code null} */
    public String getReplayJob() {
        return replayJob;
    }

    /** @return 재생할 원래 슬롯. 배치 재시도 밖에서 났으면 {@code null} */
    public Instant getReplaySlot() {
        return replaySlot;
    }

    private static String message(int committedChunks, String sqlState, String job, Instant slot) {
        String base = "알림 배치의 조각 " + committedChunks + "개가 이미 커밋된 뒤 잠금 충돌(" + sqlState
                + ")이 소진됐다 — 다시 판정하면 같은 슬롯에 다른 종류의 알림이 한 번 더 적힐 수 있어 재판정하지 않는다.";
        if (job == null) {
            return base;
        }
        return base + " 커밋된 조각을 확인한 뒤 같은 슬롯으로 재생: NotificationCronReplayService.replay(\"" + job
                + "\", Instant.parse(\"" + slot + "\"))";
    }
}
