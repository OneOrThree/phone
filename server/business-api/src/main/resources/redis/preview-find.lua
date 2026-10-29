if redis.call('GET', KEYS[65]) then return nil end
-- 큰 payload는 일치한 슬롯에서만 읽는다. 전체 Redis 키 공간을 순회하지 않는다.
for i = 1, 64 do
    if redis.call('HGET', KEYS[i], 'identity') == ARGV[1] then
        if redis.call('HGET', KEYS[i], 'complete') == '1' then
            local now = redis.call('TIME')
            redis.call('HSET', KEYS[i], 'touched', now[1] * 1000000 + now[2])
        end
        return redis.call('HGET', KEYS[i], 'entry')
    end
end
return nil
