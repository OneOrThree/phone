package com.oneorthree.phone.construction.service;

/**
 * 섬 배치 기본 템플릿 — 행이 없는 섬의 첫 조회 때 이 값으로 {@code island_layouts} 를 만든다 (GROMO-2232).
 *
 * <p>출처: 앱 {@code app/app-dev/src/assets/village-world/map.json}(1536×1024 px, version 4) 의
 * {@code objects[]} 중 {@code building} 필드가 있는 7개. 서버는 앱 파일을 읽지 않는다 — 값만 복사했다.
 * <ul>
 *   <li>{@code cell} = 앵커 px 를 100×100 통행 셀로 — x·100/1536, y·100/1024 의 floor.
 *       예: 회관 앵커 (1095,321) → (71,31).</li>
 *   <li>{@code footprint} = 스프라이트 상자(bottom-center 앵커: x±w/2, y−h..y)의 네 꼭짓점을 같은 변환으로 —
 *       최소 쪽은 floor, 최대 쪽은 ceil 이라 상자를 덮는다. 충돌 정밀화는 Movement 컴파일러 몫이다.</li>
 * </ul>
 * 순서는 정책 C01 의 건물 7개 표시 순서다. 맵 원화가 바뀌면 이 상수와 map.json 을 함께 고친다.
 */
final class IslandLayoutTemplate {

    static final String DEFAULT_LAYOUT_JSON = """
            {"schemaVersion":1,"mapId":"home","buildings":[\
            {"id":"hall","cell":{"x":71,"y":31},"anchor":"bottom-center",\
            "footprint":[[63,7],[80,7],[80,32],[63,32]]},\
            {"id":"board","cell":{"x":60,"y":31},"anchor":"bottom-center",\
            "footprint":[[57,23],[64,23],[64,32],[57,32]]},\
            {"id":"gram","cell":{"x":28,"y":48},"anchor":"bottom-center",\
            "footprint":[[26,39],[32,39],[32,49],[26,49]]},\
            {"id":"library","cell":{"x":80,"y":58},"anchor":"bottom-center",\
            "footprint":[[72,26],[89,26],[89,59],[72,59]]},\
            {"id":"mail","cell":{"x":23,"y":58},"anchor":"bottom-center",\
            "footprint":[[22,52],[26,52],[26,59],[22,59]]},\
            {"id":"tower","cell":{"x":13,"y":19},"anchor":"bottom-center",\
            "footprint":[[9,0],[17,0],[17,20],[9,20]]},\
            {"id":"shop","cell":{"x":65,"y":73},"anchor":"bottom-center",\
            "footprint":[[56,53],[74,53],[74,74],[56,74]]}\
            ]}""";

    private IslandLayoutTemplate() {
    }
}
