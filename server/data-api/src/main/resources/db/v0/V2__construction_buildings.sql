-- 건물 종류의 표시 정보·모금 방식·선행 관계를 코드 enum에서 데이터로 옮긴다.
-- 계약 ID는 기존 시설·목표·가격표와 앱이 사용하므로 바꾸지 않는다.
CREATE TABLE construction_buildings (
    id varchar(30) PRIMARY KEY,
    display_name varchar(100) NOT NULL,
    display_order integer NOT NULL,
    funding varchar(20) NOT NULL,
    CONSTRAINT construction_buildings_id_ck CHECK (id ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT construction_buildings_name_ck CHECK (length(trim(display_name)) > 0),
    CONSTRAINT construction_buildings_funding_ck
        CHECK (funding IN ('WALLET_TOTAL', 'RESIDENT_SPLIT'))
);

CREATE TABLE construction_building_prerequisites (
    building_id varchar(30) NOT NULL REFERENCES construction_buildings(id) ON DELETE RESTRICT,
    prerequisite_id varchar(30) NOT NULL REFERENCES construction_buildings(id) ON DELETE RESTRICT,
    PRIMARY KEY (building_id, prerequisite_id),
    CONSTRAINT construction_building_prerequisites_not_self_ck CHECK (building_id <> prerequisite_id)
);

INSERT INTO construction_buildings (id, display_name, display_order, funding) VALUES
    ('hall', '회관', 1, 'WALLET_TOTAL'),
    ('board', '게시판', 2, 'WALLET_TOTAL'),
    ('gram', '방송기', 3, 'RESIDENT_SPLIT'),
    ('library', '도서관', 4, 'RESIDENT_SPLIT'),
    ('mail', '우체통', 5, 'RESIDENT_SPLIT'),
    ('tower', '전망대', 6, 'RESIDENT_SPLIT'),
    ('shop', '상점', 7, 'RESIDENT_SPLIT');

INSERT INTO construction_building_prerequisites (building_id, prerequisite_id) VALUES
    ('board', 'hall'),
    ('gram', 'board'),
    ('library', 'board'),
    ('mail', 'board'),
    ('tower', 'board'),
    ('shop', 'gram'),
    ('shop', 'library'),
    ('shop', 'mail'),
    ('shop', 'tower');

-- 기존 문자열 참조도 DB 정본을 가리키게 한다. 알 수 없는 ID가 운영 데이터에 있다면
-- 이 이행을 실패시켜 조용히 완공 시설이 사라지는 일을 막는다.
ALTER TABLE construction_cost_policies
    ADD CONSTRAINT construction_cost_policies_building_id_fkey
        FOREIGN KEY (building_id) REFERENCES construction_buildings(id) ON DELETE RESTRICT;
ALTER TABLE island_facilities
    ADD CONSTRAINT island_facilities_building_id_fkey
        FOREIGN KEY (building_id) REFERENCES construction_buildings(id) ON DELETE RESTRICT;
ALTER TABLE island_construction_states
    ADD CONSTRAINT island_construction_states_target_building_id_fkey
        FOREIGN KEY (target_building_id) REFERENCES construction_buildings(id) ON DELETE RESTRICT;
