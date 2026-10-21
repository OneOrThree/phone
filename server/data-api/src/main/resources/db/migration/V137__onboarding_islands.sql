-- 첫 소속이 없고 망원경에 정원 남은 섬이 없을 때만 마련하는 개인 무인도.
-- 기존 groups 행은 비공개·주민 0명이며, 실제 SEA 도착 후 소속을 만들 때 예약을 삭제한다.
CREATE TABLE onboarding_islands (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    island_id uuid NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE
);
