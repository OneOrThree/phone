"""자기 검사: 검정 → 검정으로 옮기면 승인 리그(walk·focus·reel 14프레임)와 같아야 한다.
변환이 항등이 아니면 등록·좌표 변환이 깨진 것."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_rigs as g  # noqa: E402

head_b, neck_b, _ = g.black_rigs()
head, neck, _ = g.transfer('black', {})
for fid, hb in head_b.items():
    h = head[fid]
    assert abs(h['x'] - hb['x']) <= 1 and abs(h['y'] - hb['y']) <= 1, (fid, h, hb)
    assert abs(h['angleDegrees'] - hb['angleDegrees']) <= 1, (fid, h, hb)
for fid, b in neck_b['frames'].items():
    f = neck['frames'][fid]
    assert all(abs(u - v) <= 1 for u, v in zip(f['anchor'], b['anchor'])), (fid, f['anchor'], b['anchor'])
    assert len(f['occluders']) == len(b['occluders'])
print('selftest ok')
