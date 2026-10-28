package com.oneorthree.phone.outbox.service;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Collection;
import java.util.List;
import java.util.NavigableSet;
import java.util.TreeSet;
import java.util.UUID;

/**
 * USER aggregate 잠금의 <b>정본 순서</b>와 그 순서를 어기는 획득의 감시 (GROMO-893).
 *
 * <h2>왜 정본 순서가 필요한가</h2>
 * {@code aggregate_versions(USER, userId)} 잠금은 트랜잭션이 끝날 때까지 유지된다. 한 트랜잭션이 A→B,
 * 다른 트랜잭션이 B→A 로 잡으면 PostgreSQL 은 한쪽을 {@code 40P01} 로 끊고 그 트랜잭션 전체가 롤백된다.
 * 루프마다 정렬해도 소용없다 — 페이지·그룹·회차마다 따로 정렬하면 트랜잭션 «전체»의 획득 순서는
 * 여전히 섞인다. 그래서 순서를 전역 하나로 못 박고, 한 트랜잭션 안에서 그 순서를 거꾸로 거스르는 획득을
 * 이 자리에서 잡는다.
 *
 * <h2>정본 순서 = {@code UUID.toString()} 사전순 = SQL {@code COLLATE "C"}</h2>
 * {@code UUID.compareTo} 는 상·하위 long 을 <b>부호 있는</b> 정수로 비교해 문자열 순서와 다르다.
 * Java 에서 정렬한 단건 잠금과 SQL 에서 정렬한 일괄 잠금이 서로 다른 기준을 쓰면 두 경로 사이에서 다시
 * 순환이 생긴다. 소문자 hex 와 하이픈만 쓰는 UUID 문자열은 UTF-16 코드 단위 순서와 바이트 순서가 같으므로
 * {@link String#compareTo} 와 {@code COLLATE "C"} 가 정확히 일치한다.
 *
 * <h2>트랜잭션마다 따로 센다</h2>
 * 이미 쥔 잠금은 트랜잭션의 동기화 목록에 등록한 객체({@link Ledger})에 적는다. 장부가 트랜잭션 경계를 넘으면 안쪽
 * 트랜잭션이 바깥이 쥔 잠금을 «자기 것»으로 보고 멀쩡한 획득을 위반으로 센다. 동기화 객체는 자기 트랜잭션과 함께 생기고
 * 사라지므로 따로 바인드·해제·정리할 코드 없이 그 경계가 맞는다. 스프링이 실제로 하는 일(spring-tx 7.0.7):
 * <ul>
 *   <li>{@code REQUIRES_NEW} 로 안쪽 트랜잭션을 열면 {@code AbstractPlatformTransactionManager#suspend} 가 바깥의 동기화
 *       목록을 떼어 두고 비운다({@code doSuspendSynchronization}). 안쪽은 빈 목록에서 시작한다.</li>
 *   <li>안쪽이 끝나면 {@code cleanupAfterCompletion} 이 안쪽 목록을 비우고({@code TransactionSynchronizationManager#clear})
 *       떼어 둔 바깥 목록을 다시 등록한다({@code doResumeSynchronization}).</li>
 * </ul>
 * 리소스 맵({@code bindResource})으로도 같은 경계를 만들 수 있지만, 매니저의 {@code doSuspend} 는 자기 리소스(JPA 는
 * {@code EntityManagerHolder}·{@code ConnectionHolder})만 뗀다. 그 밖의 값은 함께 등록한 동기화
 * (예: {@code ResourceHolderSynchronization#suspend})가 떼고 되돌리고 완료 때 해제해야 한다 — 동기화 객체 하나로 두면
 * 그 수명 관리가 필요 없다.
 *
 * <h2>위반은 운영에서 로그·지표, 테스트에서 실패</h2>
 * 운영에서 예외로 막으면 순서를 어기는 새 경로가 곧장 장애가 된다. 대신 {@code outbox.user_lock.order_violation}
 * 지표와 경고 로그를 남기고, CI 프로파일은 {@code outbox.user-lock-order.enforce=true} 로 즉시 실패시켜
 * 그런 경로가 병합되기 전에 드러나게 한다.
 */
@Slf4j
@Component
public class UserAggregateLockOrderGuard {

    /** 위반 지표 이름. */
    public static final String VIOLATION_METRIC = "outbox.user_lock.order_violation";

    private final boolean enforce;
    private final ObjectProvider<MeterRegistry> meterRegistry;

    public UserAggregateLockOrderGuard(@Value("${outbox.user-lock-order.enforce:false}") boolean enforce,
                                       ObjectProvider<MeterRegistry> meterRegistry) {
        this.enforce = enforce;
        this.meterRegistry = meterRegistry;
    }

    /**
     * 정본 순서로 정렬한 중복 없는 id 문자열.
     *
     * @param userIds 수신자·주체 id
     * @return 정본 순서
     */
    public static List<String> canonicalOrder(Collection<UUID> userIds) {
        TreeSet<String> ordered = new TreeSet<>();
        for (UUID userId : userIds) {
            ordered.add(userId.toString());
        }
        return List.copyOf(ordered);
    }

    /**
     * 이번 트랜잭션이 아직 쥐지 않은 id 만 남긴다 — 이미 쥔 행은 다시 잠가도 대기가 없다.
     *
     * @param canonicalIds 정본 순서의 id
     * @return 새로 잡아야 하는 id(정본 순서 유지)
     */
    List<String> notYetHeld(List<String> canonicalIds) {
        Ledger ledger = currentLedger(false);
        if (ledger == null) {
            return canonicalIds;
        }
        return canonicalIds.stream().filter(id -> !ledger.held.contains(id)).toList();
    }

    /**
     * 새로 잡을 id 들이 이미 쥔 잠금보다 <b>앞</b>에 오는지 본다.
     *
     * <p>새로 잡을 것의 최소값만 보면 된다 — 정본 순서로 한 번에 잡으므로 최소값이 이미 쥔 최대값보다
     * 뒤면 나머지도 전부 뒤다.
     *
     * @param newIds 정본 순서로 정렬된, 아직 쥐지 않은 id
     * @throws IllegalStateException {@code enforce} 가 켜져 있고 순서를 거스를 때
     */
    void checkBeforeAcquire(List<String> newIds) {
        if (newIds.isEmpty()) {
            return;
        }
        Ledger ledger = currentLedger(false);
        if (ledger == null || ledger.held.isEmpty()) {
            return;
        }
        String highestHeld = ledger.held.last();
        String lowestNew = newIds.get(0);
        if (lowestNew.compareTo(highestHeld) > 0) {
            return;
        }
        MeterRegistry registry = meterRegistry.getIfAvailable();
        if (registry != null) {
            registry.counter(VIOLATION_METRIC).increment();
        }
        String message = "USER aggregate 잠금 순서 위반 — 이미 쥔 최대 " + highestHeld + " 뒤에 "
                + lowestNew + " 를 잡으려 한다. 같은 사용자 쌍을 반대 순서로 잡는 트랜잭션과 교착할 수 있다.";
        if (enforce) {
            throw new IllegalStateException(message);
        }
        log.warn(message);
    }

    /**
     * 잡은 잠금을 이번 트랜잭션의 장부에 적는다.
     *
     * @param ids 잡은 id
     */
    void recordHeld(Collection<String> ids) {
        Ledger ledger = currentLedger(true);
        if (ledger != null) {
            ledger.held.addAll(ids);
        }
    }

    /**
     * 현재 트랜잭션의 장부.
     *
     * @param create 없으면 만들지
     * @return 장부. 동기화가 꺼진 호출(트랜잭션 밖 테스트 등)이면 {@code null}
     */
    private static Ledger currentLedger(boolean create) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return null;
        }
        for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
            if (synchronization instanceof Ledger ledger) {
                return ledger;
            }
        }
        if (!create) {
            return null;
        }
        Ledger ledger = new Ledger();
        TransactionSynchronizationManager.registerSynchronization(ledger);
        return ledger;
    }

    /** 한 트랜잭션이 쥔 USER 잠금 — 트랜잭션이 끝나면 동기화 목록과 함께 사라진다. */
    private static final class Ledger implements TransactionSynchronization {
        private final NavigableSet<String> held = new TreeSet<>();
    }
}
