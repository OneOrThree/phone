"""로컬 HTTP 수집기에 도착한 실제 Sentry envelope의 JS/네이티브 진단 문맥을 검사한다."""
import gzip
import json
from pathlib import Path
import sys
import zlib

root = Path(sys.argv[1])
events = []
for path in sorted(root.glob('*.body')):
    metadata = json.loads(path.with_suffix('.json').read_text())
    body = path.read_bytes()
    if metadata.get('encoding') == 'gzip':
        body = gzip.decompress(body)
    elif metadata.get('encoding') == 'deflate':
        body = zlib.decompress(body)
    for line in body.splitlines():
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(value, dict) and 'exception' in value:
            events.append(value)

handled = [e for e in events if e.get('tags', {}).get('camera_stage') == 'capture']
native = [e for e in events if e.get('tags', {}).get('event.origin') == 'ios']
assert handled, '잡은 카메라 예외가 전송되지 않았다'
assert native, '재실행 뒤 네이티브 크래시가 전송되지 않았다'
selected = [handled[0], native[0]]
ids = []
report = []
for event in selected:
    context = event['contexts']
    camera = context['focus_camera']
    assert camera['measurement_enabled'] is True
    assert camera['preview_visible'] is True
    assert camera['camera_position'] == 'back'
    assert camera['phase'] == 'focusing'
    assert event['tags']['app.screen'] == 'focus'
    assert event['tags']['app.state'] == 'active'
    assert context['app_window']['orientation'] == 'portrait'
    ids.append(context['analytics_device']['device_id'])
    assert ids[-1] == event['tags']['analytics.device_id']
    assert context['analytics_device']['device_id_source'] == 'idfv'
    categories = {b.get('category') for b in event['breadcrumbs']}
    assert {'navigation', 'focus.camera', 'app.lifecycle', 'app.window'} <= categories
    values = event['exception']['values']
    if event is selected[0]:
        assert 'accelerometer is not available' in values[0]['value']
        assert values[0]['mechanism']['handled'] is True
        assert values[0]['stacktrace']['frames']
    else:
        assert values[0]['type'] == 'EXC_BREAKPOINT'
        assert values[0]['mechanism']['handled'] is False
        assert camera['capture_status'] == 'interrupted'
    contexts = {k: context[k] for k in ['focus_camera', 'app_window', 'analytics_device']}
    contexts['analytics_device'] = {**contexts['analytics_device'], 'device_id': '<simulator-idfv>'}
    report.append({
        'event_id': event['event_id'], 'release': event['release'],
        'type': values[0]['type'], 'value': values[0]['value'],
        'handled': values[0]['mechanism']['handled'], 'contexts': contexts,
        'breadcrumb_categories': sorted(categories),
        'app_debug_images': [
            {k: image[k] for k in ['debug_id', 'image_addr']}
            for image in event.get('debug_meta', {}).get('images', [])
            if image.get('code_file', '').endswith('/Cattus')
        ],
    })
assert ids[0] == ids[1], 'JS·네이티브 이벤트의 기기 식별자가 다르다'
print(json.dumps({'passed': True, 'receiver': 'local HTTP collector', 'same_device_id': True,
                  'intentional_native_crash': True, 'events': report}, ensure_ascii=False, indent=2))
