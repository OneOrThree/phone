-- 착공 당시 기여 주민. 과거 완공 건물의 대상을 추정해 소급 등록하지 않는다.
CREATE TABLE construction_guide_recipients (
    island_id UUID NOT NULL,
    building_id VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (island_id, building_id, user_id),
    FOREIGN KEY (island_id, building_id) REFERENCES island_facilities(island_id, building_id) ON DELETE CASCADE
);
CREATE INDEX idx_construction_guide_recipient_user ON construction_guide_recipients(user_id);
