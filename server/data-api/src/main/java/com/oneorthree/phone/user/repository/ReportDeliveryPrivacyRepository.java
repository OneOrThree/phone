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

    private static final Duration RETENTION = Duration.ofHours(24);

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public void eraseForWithdrawal(UUID userId) {
        if (!tableExists()) {
            return;
        }
        // 본인이 만든 intent는 더는 재생할 주체가 없으므로 삭제한다.
        jdbc.update("delete from report_deliveries where reporter_id=?", userId);
        Instant now = clock.instant();
        // 신고 대상 탈퇴는 행을 지우지 않는다. SMTP가 끝난 직후 삭제하면 같은 키가 새 행으로 재생성되어
        // 중복 메일이 나갈 수 있다. 활성 lease는 외부 확인 결과를 기록할 수 있게 보존하고, 그 외
        // 미확인 건은 만료, 접수 확인 건은 차단하지 못한 영수증으로 수렴한다.
        jdbc.update("update report_deliveries set status='EXPIRED', author_id=null, mail_subject=null, "
                        + "mail_body=null, lease_token=null, lease_expires_at=null, updated_at=? "
                        + "where author_id=? and status='PENDING' "
                        + "and (lease_expires_at is null or lease_expires_at<=?)",
                Timestamp.from(now), userId, Timestamp.from(now));
        jdbc.update("update report_deliveries set status='COMPLETED', blocked=false, completed_at=?, "
                        + "author_id=null, mail_subject=null, mail_body=null, lease_token=null, "
                        + "lease_expires_at=null, updated_at=? where author_id=? and status='EMAIL_CONFIRMED'",
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
                        + "mail_subject=null, mail_body=null, lease_token=null, lease_expires_at=null, updated_at=? "
                        + "where status='PENDING' and updated_at<?",
                Timestamp.from(now), cutoff);
        int finalized = jdbc.update("update report_deliveries set status='COMPLETED', blocked=false, "
                        + "completed_at=?, author_id=null, mail_subject=null, mail_body=null, lease_token=null, "
                        + "lease_expires_at=null, updated_at=? where status='EMAIL_CONFIRMED' and updated_at<?",
                Timestamp.from(now), Timestamp.from(now), cutoff);
        return expired + finalized;
    }

    private boolean tableExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.report_deliveries') is not null", Boolean.class));
    }
}
