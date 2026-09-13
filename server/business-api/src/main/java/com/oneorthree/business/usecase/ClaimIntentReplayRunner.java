package com.oneorthree.business.usecase;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 재개 <b>실행 시점</b>만 정하는 얇은 껍데기 — {@code business.claim-replay.enabled=true} 일 때만 빈이 된다.
 *
 * <h2>왜 실행과 로직을 나누나</h2>
 * ⓐ <b>서빙 프로세스에 이 동작을 시작하는 장치가 없어야 한다.</b> {@code @Scheduled} 를 두면 §6 의
 * 「Business 크론 없음」이 깨지므로, 스케줄은 코드가 아니라 <b>런북</b>에 있다 — 운영자가 같은 이미지를
 * 일회성 job 으로 띄우며 이 프로퍼티를 켠다.
 * ⓑ {@link ClaimIntentReplayService} 를 항상 빈으로 두면 테스트가 로직을 직접 검증할 수 있다.
 * 반대로 로직에 {@code ApplicationRunner} 를 붙여 두면 <b>테스트 컨텍스트가 뜨는 순간 재개가 돌아</b>
 * 상류 스텁이 없는 상태에서 컨텍스트 로딩이 실패한다(실제로 그렇게 깨졌다).
 *
 * <h2>실패와 「미완료 잔존」 둘 다 비정상 종료다</h2>
 * 실패를 삼키면 gate 가 거짓으로 통과하고 §7.2 절차가 다음 단계로 넘어간다. <b>그리고 실패가 0 이어도
 * 전체 미완료가 남아 있으면 통과가 아니다</b> — 한 순회의 빈 페이지는 「지금 집을 것이 없다」는 뜻일
 * 뿐이고, 다른 작업자의 lease·재시도 예정·커서가 지난 뒤 적재된 행이 남아 있을 수 있다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "business.claim-replay.enabled", havingValue = "true")
@RequiredArgsConstructor
public class ClaimIntentReplayRunner implements ApplicationRunner {

    private final ClaimIntentReplayService replayService;

    @Override
    public void run(ApplicationArguments args) {
        ClaimIntentReplayService.Result result = replayService.replayAll();
        log.info("claim 의도 재개 종료 — 확인 {}건, 완료 {}건, 건너뜀(lease) {}건, 실패 {}건, 전체 미완료 {}건",
                result.seen(), result.completed(), result.skipped(), result.failed(), result.pendingTotal());

        if (result.failed() > 0) {
            throw new IllegalStateException(
                    "재개하지 못한 claim 의도 " + result.failed() + "건 — 절차를 진행하지 않는다");
        }
        if (result.pendingTotal() > 0L) {
            // ⚠️ 「빈 페이지 = 전부 완료」로 접으면 안 된다. 다른 작업자의 lease·재시도 예정·커서가
            //    지난 뒤 적재된 행이 남아 있을 수 있고, 그걸 통과시키면 미완료를 남긴 채 §7.2 가
            //    다음 단계로 넘어간다. gate 는 전체 미완료 0 이다.
            throw new IllegalStateException(
                    "미완료 claim 의도 " + result.pendingTotal() + "건이 남았다(다른 lease·재시도 예정 포함)"
                            + " — 잠시 후 다시 실행하고, 0 이 될 때까지 다음 단계로 넘어가지 않는다");
        }
    }
}
