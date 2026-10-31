-- KEYS: 64개 고정 슬롯, 탈퇴 표지. ARGV: 식별자, 사용자, 세대, 직렬화 항목.
if redis.call('GET', KEYS[65]) then return 0 end
if #ARGV[4] > 1048576 or #ARGV[3] > 128 then return redis.error_reply('Preview entry too large') end
local vacant, victim, oldest = nil, nil, math.huge
for i = 1, 64 do
    local identity = redis.call('HGET', KEYS[i], 'identity')
    if identity == ARGV[1] then return 0 end
    if not identity then
        vacant = vacant or KEYS[i]
    elseif redis.call('HGET', KEYS[i], 'complete') == '1' then
        local touched = tonumber(redis.call('HGET', KEYS[i], 'touched'))
        if touched < oldest then oldest, victim = touched, KEYS[i] end
    end
end
local slot = vacant or victim
if not slot then return -1 end
redis.call('DEL', slot)
redis.call('HSET', slot, 'identity', ARGV[1], 'user', ARGV[2], 'generation', ARGV[3],
    'entry', ARGV[4], 'complete', '0', 'touched', '0')
redis.call('EXPIRE', slot, 90)
return 1
