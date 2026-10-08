package com.oneorthree.phone.construction.service;

/**
 * 섬 배치 기본 템플릿 — 행이 없는 섬의 첫 조회 때 이 값으로 {@code island_layouts} 를 만든다 (GROMO-2232).
 *
 * <p>출처: 앱 기존 마을 {@code app/app-dev/src/assets/backgrounds/island/placement.json}(1536×1024 px) 의
 * 시설 7개 {@code rect[x,y,w,h]} — 타일 섬은 기존 마을을 2배로 올려 자른 것이다. 서버는 앱 파일을 읽지 않는다 — 값만 복사했다.
 * <ul>
 *   <li>{@code cell} = 앵커 px 를 100×100 통행 셀로 — x·100/1536, y·100/1024 의 floor.
 *       앵커는 rect 의 아래 가운데(x+w/2, y+h). 예: 회관 앵커 (1070,265) → (69,25).</li>
 *   <li>{@code footprint} = rect 의 네 꼭짓점을 같은 변환으로 —
 *       최소 쪽은 floor, 최대 쪽은 ceil 이라 상자를 덮는다. 충돌 정밀화는 Movement 컴파일러 몫이다.</li>
 * </ul>
 * 순서는 정책 C01 의 건물 7개 표시 순서다. 맵 원화가 바뀌면 이 상수와 placement.json 을 함께 고친다.
 */
final class IslandLayoutTemplate {

    static final String DEFAULT_LAYOUT_JSON = """
            {"schemaVersion":1,"mapId":"home","buildings":[\
            {"id":"hall","cell":{"x":69,"y":25},"anchor":"bottom-center",\
            "footprint":[[61,2],[78,2],[78,26],[61,26]]},\
            {"id":"board","cell":{"x":58,"y":23},"anchor":"bottom-center",\
            "footprint":[[55,15],[61,15],[61,24],[55,24]]},\
            {"id":"gram","cell":{"x":23,"y":46},"anchor":"bottom-center",\
            "footprint":[[21,38],[27,38],[27,47],[21,47]]},\
            {"id":"library","cell":{"x":80,"y":59},"anchor":"bottom-center",\
            "footprint":[[72,28],[89,28],[89,60],[72,60]]},\
            {"id":"mail","cell":{"x":20,"y":56},"anchor":"bottom-center",\
            "footprint":[[19,50],[23,50],[23,57],[19,57]]},\
            {"id":"tower","cell":{"x":13,"y":21},"anchor":"bottom-center",\
            "footprint":[[9,2],[18,2],[18,22],[9,22]]},\
            {"id":"shop","cell":{"x":38,"y":76},"anchor":"bottom-center",\
            "footprint":[[29,56],[47,56],[47,77],[29,77]]}\
            ]}""";

    private IslandLayoutTemplate() {
    }
}
