if redis.call('GET', KEYS[65]) then return 0 end
if #ARGV[3] > 1048576 then return redis.error_reply('Preview entry too large') end
for i = 1, 64 do
    if redis.call('HGET', KEYS[i], 'identity') == ARGV[1]
        and redis.call('HGET', KEYS[i], 'generation') == ARGV[2]
        and redis.call('HGET', KEYS[i], 'complete') == '0' then
        local now = redis.call('TIME')
        redis.call('HSET', KEYS[i], 'entry', ARGV[3], 'complete', '1', 'touched', now[1] * 1000000 + now[2])
        redis.call('EXPIRE', KEYS[i], ARGV[4])
        return 1
    end
end
return 0
