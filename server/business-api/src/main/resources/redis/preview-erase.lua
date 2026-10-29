-- 탈퇴 표지를 먼저 기록하고 슬롯과 레이트를 한 번에 삭제한다.
redis.call('SET', KEYS[65], '1', 'PXAT', ARGV[2])
local removed = redis.call('DEL', KEYS[66])
for i = 1, 64 do
    if redis.call('HGET', KEYS[i], 'user') == ARGV[1] then
        removed = removed + redis.call('DEL', KEYS[i])
    end
end
return removed
