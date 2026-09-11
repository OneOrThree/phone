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
 * <h2>왜 이제 와서 필요해졌나 (GROMO-292)</h2>
 * 종전에는 PK 순서에 기대는 조회가 없어서 무해했다. 그런데 집중 프레즌스 리스가
 * <b>{@code focus_sessions.id} 의 시간 순서</b>로 「어느 시작·종료가 더 새로운가」를 판정하기 시작했다
 * ({@code common/port/RedisFocusPresence}). 그 순간부터 이 성질은 «있으면 좋은 것»이 아니라 계약이다 —
 * 단조성이 깨지면 정상적인 새 시작이 「이미 끝난 세션」으로 무시되거나, 옛 리스가 남아 새 세션의
 * 종료로도 지워지지 않아 최대 13시간 채팅이 막힌다.
 *
 * <p>스레드 안전하다(8스레드 × 5,000건 = 40,000건 전부 고유). 그래서 static 하나로 공유한다.
 *
 * <h2>남는 한계(수용)</h2>
 * 단조성은 <b>JVM 하나 안에서만</b> 성립한다. 인스턴스가 둘일 때 같은 밀리초에 각각 발급한 두 id 의
 * 상대 순서는 시계 정확도에 달려 있다. 프레즌스 판정에서 이게 문제가 되려면 <b>같은 유저</b>의 서로
 * 다른 두 집중 세션이 1밀리초 안에 서로 다른 인스턴스에서 생성돼야 하는데, 같은 유저의
 * {@code startFocusSession} 은 유저 행 배타 락으로 직렬화되고 그 사이 커밋 왕복만으로도 보통 1ms 를
 * 넘는다. 그 창은 수용한다.
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
