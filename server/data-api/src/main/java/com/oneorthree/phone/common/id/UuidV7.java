package com.oneorthree.phone.common.id;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.impl.TimeBasedEpochGenerator;

import java.util.UUID;

/**
 * 이 서비스의 <b>유일한</b> UUID v7 발급구.
 *
 * <h2>생성기 선택은 취향이 아니라 계약이다</h2>
 * UUID v7 은 앞 48비트가 epoch 밀리초라 «밀리초가 다르면» 정렬이 곧 시간순이다. 문제는 <b>같은
 * 밀리초 안</b>이고, 거기서 무엇이 순서를 정하는지는 생성기마다 다르다. 실측(각 20,000건 연속 생성,
 * 부호 없는 바이트 비교 기준 역전 횟수):
 *
 * <table>
 *   <caption>같은 밀리초 안의 단조성</caption>
 *   <tr><th>방식</th><th>역전</th></tr>
 *   <tr><td>{@code timeBasedEpochGenerator()} — <b>인스턴스 하나를 공유</b></td><td>0 / 20,000</td></tr>
 *   <tr><td>{@code timeBasedEpochGenerator()} — 호출마다 새 인스턴스</td><td>9,993 / 20,000</td></tr>
 *   <tr><td>{@code timeBasedEpochRandomGenerator()}</td><td>9,971 / 20,000</td></tr>
 * </table>
 *
 * <p>공유 인스턴스만 카운터를 이어받아 단조롭다. <b>{@code Generators.…().generate()} 처럼 호출마다
 * 새로 만들면 그 카운터가 매번 초기화되어 단조성이 사라진다</b> — 그래도 UUID 는 잘 나오고 테스트도
 * 대부분 통과하기 때문에, 이 실수는 「가끔 순서가 뒤집힌다」는 재현 안 되는 버그로만 드러난다.
 *
 * <h2>집중 프레즌스는 더 이상 이 순서에 기대지 않는다 (GROMO-292 → GROMO-1743)</h2>
 * 집중 프레즌스 리스는 한때 <b>{@code focus_sessions.id} 의 시간 순서</b>로 「어느 시작·종료가 더
 * 새로운가」를 판정했다. 아래 한계 때문에 그 판정은 DB 시퀀스({@code focus_sessions.presence_order})로
 * 옮겼다 — 인스턴스가 여럿이어도 한 축이다.
 *
 * <p>스레드 안전하다(8스레드 × 5,000건 = 40,000건 전부 고유). 그래서 static 하나로 공유한다.
 *
 * <h2>한계</h2>
 * 단조성은 <b>JVM 하나 안에서만</b> 성립한다. 인스턴스가 여럿이면 id 의 상대 순서는 각 인스턴스의
 * 시계에 달려 있어, 시계가 앞선 인스턴스의 «이전» id 가 더 클 수 있다. 인스턴스 사이의 순서가 필요한
 * 곳은 id 가 아니라 공유 저장소가 발급한 번호를 써야 한다(프레즌스가 그렇게 옮겼다, GROMO-1743).
 */
public final class UuidV7 {

    /** 공유 생성기. <b>이 필드를 지역 변수로 바꾸지 마라</b> — 위 표의 첫 줄이 셋째 줄로 바뀐다. */
    private static final TimeBasedEpochGenerator GENERATOR = Generators.timeBasedEpochGenerator();

    private UuidV7() {
    }

    /** 시간 단조 UUID v7 하나. */
    public static UUID next() {
        return GENERATOR.generate();
    }
}
