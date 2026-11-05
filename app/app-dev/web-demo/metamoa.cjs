const draft = require('./submission.json');

// 이 도구는 서버 환경 변수를 주입받아 관리 API만 호출한다. 키를 파일로 쓰거나 출력하지 않는다.
async function main() {
  const [action, eventId] = process.argv.slice(2);
  if (!action) {
    console.log(JSON.stringify({ ...draft, api_hookup: true }, null, 2));
    console.log(
      '미제출. 등록은 소유자의 약관 동의를 받은 뒤 서버 비밀 환경 변수 저장과 함께 실행합니다.',
    );
    return;
  }
  if (
    ![
      '--status',
      '--sync-status',
      '--update',
      '--event',
      '--events',
      '--delete-event',
      '--character-png',
      '--character-glb',
      '--character-status',
    ].includes(action)
  )
    throw new Error(
      '사용법: node web-demo/metamoa.cjs [--status | --sync-status | --update | --event | --events | --delete-event ID | --character-png | --character-glb | --character-status]',
    );
  if (!process.env.METAMOA_ADMIN_KEY)
    throw new Error('서버 환경 변수 METAMOA_ADMIN_KEY가 필요합니다.');
  if (action === '--delete-event' && !/^[1-9][0-9]*$/.test(eventId || ''))
    throw new Error('삭제할 이벤트 ID가 필요합니다.');
  const path = {
    '--status': 'status',
    '--sync-status': 'sync-status',
    '--update': 'update',
    '--event': 'events',
    '--events': 'events',
    '--delete-event': `events/${eventId}`,
    '--character-png': 'character',
    '--character-glb': 'character',
    '--character-status': 'character',
  }[action];
  const writes = action === '--update' || action === '--event';
  const binary = action === '--character-png' || action === '--character-glb';
  const contentType = action === '--character-png' ? 'image/png' : 'model/gltf-binary';
  let body;
  if (binary) {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.byteLength;
      if (size > (action === '--character-png' ? 1024 * 1024 : 4 * 1024 * 1024))
        throw new Error('캐릭터 파일이 너무 큽니다.');
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  } else if (writes) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 8192) throw new Error('입력이 너무 큽니다.');
    }
    body = JSON.stringify(JSON.parse(input));
  }
  const response = await fetch(`https://try.oneorthree.world/service-api/metamoa/${path}`, {
    method: action === '--delete-event' ? 'DELETE' : binary ? 'PUT' : writes ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.METAMOA_ADMIN_KEY}`,
      'Content-Type': binary ? contentType : 'application/json',
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`관리 API 실패: HTTP ${response.status}`);
  const data = response.status === 204 ? { ok: true } : await response.json();
  // 응답의 명시된 비밀이 아닌 상태 필드만 표시한다.
  const safe = Object.fromEntries(
    ['ok', 'submitted', 'id', 'status', 'space_id', 'last_sync', 'upload_id', 'events']
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
  console.log(JSON.stringify(safe, null, 2));
}
main().catch(() => {
  console.error(
    '메타모아 명령 실패. 서버 환경 변수·HTTP 상태를 확인하세요. 비밀값은 출력하지 않습니다.',
  );
  process.exitCode = 1;
});
