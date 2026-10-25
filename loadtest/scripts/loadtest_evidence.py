"""중단된 측정의 원시 집계와 정상 결과가 같은 규칙을 사용하도록 정규화한다."""
import datetime as dt
import json
import os
from pathlib import Path
import tempfile


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def metric(summary, name, key, default=None):
    return summary.get('metrics', {}).get(name, {}).get('values', {}).get(key, default)


def normalize_stage(checkpoint, summary, status):
    """미수거 값은 null, 부분 집계는 하한이며 신호 중단은 절대 PASS가 아니다."""
    duration = summary.get('state', {}).get('testRunDurationMs', 0) / 1000
    available = bool(summary and duration > 0)
    count = lambda name: metric(summary, name, 'count') if available else None
    requests, iterations, completed = (count(name) for name in ('http_reqs', 'iterations', 'completed_journeys'))
    started, finished = (count(name) for name in ('started_journeys', 'finished_journeys'))
    dropped = metric(summary, 'dropped_iterations', 'count', 0) if available else None
    error_rate = metric(summary, 'http_req_failed', 'rate')
    api_rate = metric(summary, 'api_errors', 'rate')
    p95 = metric(summary, 'http_req_duration', 'p(95)')
    journey_p95 = metric(summary, 'iteration_duration', 'p(95)')
    limit = checkpoint['latencyLimitMs']
    latency = journey_p95 if checkpoint['kind'] in ('journey', 'write_journey') else p95
    failed = [name for name, data in summary.get('metrics', {}).items()
              if any(not threshold.get('ok', False) for threshold in data.get('thresholds', {}).values())]
    interrupted = bool(status.get('stopReason'))
    valid = available and requests is not None and iterations is not None and requests > 0 and iterations > 0
    counts_consistent = all(isinstance(value, (int, float)) and value >= 0 and value == int(value)
                            for value in (completed, started, finished))
    counts_consistent = counts_consistent and completed <= finished <= started
    valid = valid and counts_consistent
    valid = valid and status.get('exitCode') in (0, 99) and not status.get('timedOut')
    full = available and duration >= checkpoint['plannedSeconds'] - .5
    if interrupted or (counts_consistent and started > finished):
        verdict = 'PARTIAL'
    elif not valid or error_rate is None or api_rate is None:
        verdict = 'INVALID'
    elif failed or error_rate >= .05 or api_rate >= .05 or not full:
        verdict = 'ABORT'
    elif checkpoint['phase'] == 'warmup' and (error_rate > 0 or api_rate > 0 or dropped > 0):
        verdict = 'PREFLIGHT_FAILED'
    elif checkpoint['phase'] != 'warmup' and (error_rate > .01 or api_rate > .01 or
            dropped > checkpoint['targetRate'] * checkpoint['plannedSeconds'] * .01 or latency is None or latency > limit):
        verdict = 'SLO_LIMIT'
    else:
        verdict = 'PASS'
    lower_bound = started - finished if counts_consistent else None
    window = summary.get('loadtest', {})
    start_ms, end_ms = window.get('measurementStartEpochMs'), window.get('measurementEndEpochMs')
    has_window = isinstance(start_ms, (int, float)) and isinstance(end_ms, (int, float)) and end_ms >= start_ms
    row = {**checkpoint, **status,
           'measuredSeconds': round(duration, 6) if available else None,
           'measurementStartAt': dt.datetime.fromtimestamp(start_ms / 1000, dt.timezone.utc).isoformat() if has_window else None,
           'measurementWindowSeconds': (end_ms - start_ms) / 1000 if has_window else None,
           'measurementEndAt': dt.datetime.fromtimestamp(end_ms / 1000, dt.timezone.utc).isoformat() if has_window else None,
           'requests': requests, 'actualRps': requests / duration if available and requests is not None else None,
           'iterations': iterations, 'completedJourneys': completed,
           'completedTps': completed / duration if available and completed is not None else None,
           'startedJourneys': started, 'finishedJourneys': finished,
           'journeyCountsConsistent': counts_consistent, 'inflightJourneysLowerBound': lower_bound,
           'inflightOutcomeKnown': bool(lower_bound == 0 and not interrupted and valid),
           'countsAreLowerBounds': interrupted or not valid or lower_bound is None or lower_bound > 0,
           'p50ms': metric(summary, 'http_req_duration', 'med'), 'p95ms': p95,
           'p99ms': metric(summary, 'http_req_duration', 'p(99)'),
           'journeyP50ms': metric(summary, 'iteration_duration', 'med'), 'journeyP95ms': journey_p95,
           'journeyP99ms': metric(summary, 'iteration_duration', 'p(99)'),
           'httpErrorRate': error_rate, 'apiErrorRate': api_rate, 'dropped': dropped,
           'droppedRate': dropped / (checkpoint['targetRate'] * checkpoint['plannedSeconds']) if dropped is not None else None,
           'droppedDenominator': 'planned arrivals; 중단 후 미발신 요청은 오류 또는 drop으로 추정하지 않음',
           'observedVusMax': metric(summary, 'vus', 'max'), 'allocatedVusMax': metric(summary, 'vus_max', 'max'),
           'verdict': verdict, 'failedThresholds': failed, 'fullDuration': full,
           'rateDenominator': 'k6 testRunDurationMs: 해당 구성요소 실행 및 종료 유예 포함',
           'inflightNote': '미확인 여정은 성공/실패 0건으로 대체하지 않는다. 서버 반영 여부는 별도 원장 대조가 필요하다.'}
    return row


def recover_http(directory, stop_reason):
    """감독자가 강제 종료 후 checkpoint/raw를 회수한다. 완료 행은 그대로 보존한다."""
    directory = Path(directory)
    rows = read_json(directory / 'results.json', [])
    keys = {row['key'] for row in rows}
    for path in sorted(directory.glob('*-checkpoint.json')):
        checkpoint = read_json(path)
        if not checkpoint or checkpoint['key'] in keys:
            continue
        status = read_json(directory / (checkpoint['key'] + '-status.json'))
        if status and status.get('verdict'):
            row = status
        else:
            raw = read_json(directory / checkpoint['rawFile'], {})
            row = normalize_stage(checkpoint, raw, {'endedAt': now(), 'exitCode': None,
                'stopReason': stop_reason or 'CHILD_EXIT_WITHOUT_RESULT', 'recoveredBySupervisor': True,
                'summaryExists': bool(raw)})
        rows.append(row)
    if directory.exists():
        atomic_json(directory / 'results.json', rows)
    return rows


def measurement_windows(components, chat):
    windows = []
    for name, rows in components.items():
        for row in rows:
            if row.get('phase') == 'measurement':
                windows.append({'component': name, 'startedAt': row.get('measurementStartAt'),
                    'endedAt': row.get('measurementEndAt'), 'measuredSeconds': row.get('measuredSeconds'),
                    'requests': row.get('requests'), 'completedJourneys': row.get('completedJourneys'), 'basis': 'testRunDuration',
                    'actualRps': row.get('actualRps'), 'completedTps': row.get('completedTps'),
                    'verdict': row.get('verdict')})
    if chat:
        bounds = [chat.get('eventWindowStart'), chat.get('eventWindowEnd')]
        windows.append({'component': 'chat',
            'startedAt': dt.datetime.fromtimestamp(bounds[0] / 1000, dt.timezone.utc).isoformat() if bounds[0] is not None else None,
            'endedAt': dt.datetime.fromtimestamp(bounds[1] / 1000, dt.timezone.utc).isoformat() if bounds[1] is not None else None,
            'measuredSeconds': chat.get('measurementMs') / 1000 if chat.get('measurementMs') is not None else None,
            'sendPerSecond': chat.get('sendPerSecond'), 'deliveryPerSecond': chat.get('deliveryPerSecond'),
            'valid': chat.get('valid'), 'sloPassed': chat.get('sloPassed')})
    known = len(windows) == 3 and all(w['startedAt'] and w['endedAt'] for w in windows)
    # ISO 문자열 사전순 비교는 소수부 유무·오프셋 표기가 섞이면 틀리므로 파싱한 뒤 비교한다.
    parse = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    start = max((w['startedAt'] for w in windows), key=parse) if known else None
    end = min((w['endedAt'] for w in windows), key=parse) if known else None
    overlap = max(0, (parse(end) - parse(start)).total_seconds()) if known else None
    return {'measurementWindows': windows, 'commonMeasurementStartAt': start,
            'commonMeasurementEndAt': end, 'commonMeasurementOverlapSeconds': overlap,
            'commonWindowThroughput': None,
            'measurementOverlapMethod': '각 구성요소의 실제 UTC 구간 교집합. 개별 전체 집계는 겹침 구간 TPS로 환산하지 않음. 시작/종료 누락 시 교집합도 미확인.'}


def assess_common_window(overlap, planned_seconds, components_complete, tolerance_seconds=.1):
    sufficient = overlap is not None and overlap >= planned_seconds - tolerance_seconds
    return {'commonMeasurementPlannedSeconds': planned_seconds,
            'commonMeasurementToleranceSeconds': tolerance_seconds,
            'componentsComplete': components_complete,
            'commonWindowVerdict': 'PASS' if sufficient else 'INCOMPLETE_WINDOW',
            'mixedPassed': bool(components_complete and sufficient)}
