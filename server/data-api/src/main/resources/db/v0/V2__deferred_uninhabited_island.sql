ALTER TABLE focus_session_details
    DROP CONSTRAINT focus_session_details_island_id_fkey,
    ADD COLUMN new_island_destination boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT focus_session_details_new_island_destination_ck
        CHECK (NOT new_island_destination OR kind = 'SEA');

COMMENT ON COLUMN focus_session_details.new_island_destination IS
    '무인도 후보 항해. 성공 정산 때 실제 섬을 만들고 island_id를 교체하며 false로 바꾼다.';
