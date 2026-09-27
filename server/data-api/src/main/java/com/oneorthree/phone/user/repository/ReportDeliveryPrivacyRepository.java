package com.oneorthree.phone.user.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/** 탈퇴와 장기 중단된 신고 intent에서 개인정보 snapshot을 제거한다. */
@Repository
@RequiredArgsConstructor
public class ReportDeliveryPrivacyRepository {

    // 정리 작업이 매시간 실행되므로 기준을 한 주기 앞당겨 실제 보존 시간이 24시간을 넘지 않게 한다.
    private static final Duration RETENTION = Duration.ofHours(23);

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public void eraseForWithdrawal(UUID userId) {
        if (!tableExists()) {
            return;
        }
        // 상호 신고한 두 사용자가 동시에 탈퇴해도 두 트랜잭션이 report 행을 같은 UUID 순서로
        // 선점하게 한다. 이후 DELETE와 UPDATE가 서로 반대 행을 먼저 잡아 교착하는 것을 막는다.
        jdbc.query("select id from report_deliveries where reporter_id=? or author_id=? order by id for update",
                (rs, rowNum) -> rs.getObject("id", UUID.class), userId, userId);
        // 본인이 만든 intent는 더는 재생할 주체가 없으므로 삭제한다.
        jdbc.update("delete from report_deliveries where reporter_id=?", userId);
        Instant now = clock.instant();
        // 신고 대상 탈퇴는 행을 지우지 않는다. SMTP가 끝난 직후 삭제하면 같은 키가 새 행으로 재생성되어
        // 중복 메일이 나갈 수 있다. 활성 lease는 외부 확인 결과를 기록할 수 있게 보존하고, 그 외
        // 미확인 건은 만료, 접수 확인 건은 차단하지 못한 영수증으로 수렴한다.
        jdbc.update("update report_deliveries set status='EXPIRED', author_id=null, mail_subject=null, "
                        + "mail_body=null, snapshot_stored_at=null, lease_token=null, lease_expires_at=null, "
                        + "updated_at=? "
                        + "where author_id=? and status='PENDING' "
                        + "and (lease_expires_at is null or lease_expires_at<=?)",
                Timestamp.from(now), userId, Timestamp.from(now));
        jdbc.update("update report_deliveries set status='COMPLETED', blocked=false, completed_at=?, "
                        + "author_id=null, mail_subject=null, mail_body=null, lease_token=null, "
                        + "lease_expires_at=null, snapshot_stored_at=null, updated_at=? "
                        + "where author_id=? and status='EMAIL_CONFIRMED'",
                Timestamp.from(now), Timestamp.from(now), userId);
    }

    @Transactional
    public int purgeStale() {
        if (!tableExists()) {
            return 0;
        }
        Instant now = clock.instant();
        Timestamp cutoff = Timestamp.from(now.minus(RETENTION));
        int expired = jdbc.update("update report_deliveries set status='EXPIRED', author_id=null, "
                        + "mail_subject=null, mail_body=null, snapshot_stored_at=null, lease_token=null, "
                        + "lease_expires_at=null, updated_at=? where status='PENDING' "
                        + "and coalesce(snapshot_stored_at, created_at)<?",
                Timestamp.from(now), cutoff);
        int finalized = jdbc.update("update report_deliveries set status='COMPLETED', blocked=false, "
                        + "completed_at=?, author_id=null, mail_subject=null, mail_body=null, lease_token=null, "
                        + "lease_expires_at=null, snapshot_stored_at=null, updated_at=? "
                        + "where status='EMAIL_CONFIRMED' and snapshot_stored_at<?",
                Timestamp.from(now), Timestamp.from(now), cutoff);
        return expired + finalized;
    }

    private boolean tableExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.report_deliveries') is not null", Boolean.class));
    }
}
