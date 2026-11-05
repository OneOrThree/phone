const fs = require('node:fs');
const path = require('node:path');

const draft = require('./submission.json');
const api = 'https://metamoa.com/api/submit';
const receipt = path.resolve(__dirname, '../.env.metamoa');

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--submit', '--agree', '--status'].includes(arg))) {
    throw new Error('사용법: node web-demo/metamoa.cjs [--submit --agree | --status]');
  }
  if (args.includes('--status')) {
    if (args.length !== 1) throw new Error('--status는 단독으로 사용합니다.');
    const values = Object.fromEntries(
      fs
        .readFileSync(receipt, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    if (!values.METAMOA_REQUEST_KEY || !values.METAMOA_SUBMISSION_ID)
      throw new Error('접수 정보가 없습니다.');
    const response = await fetch(`${api}/${encodeURIComponent(values.METAMOA_SUBMISSION_ID)}`, {
      headers: { Authorization: `Bearer ${values.METAMOA_REQUEST_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`결과 조회 실패: HTTP ${response.status}`);
    const result = await response.json();
    console.log(
      JSON.stringify({ id: values.METAMOA_SUBMISSION_ID, status: result.status }, null, 2),
    );
    return;
  }
  if (!args.includes('--submit')) {
    console.log(JSON.stringify(draft, null, 2));
    console.log(
      '미제출. 소유자가 실제 등록과 약관·개인정보처리방침 동의를 승인한 뒤에만 --submit --agree로 실행합니다.',
    );
    console.log('https://metamoa.com/terms\nhttps://metamoa.com/privacy');
    return;
  }
  if (!args.includes('--agree'))
    throw new Error('소유자의 약관·개인정보처리방침 동의를 확인한 후 --agree가 필요합니다.');
  if (fs.existsSync(receipt))
    throw new Error('.env.metamoa 접수 기록이 있습니다. 중복 제출하지 말고 결과를 조회하세요.');
  const site = await fetch(draft.url, { signal: AbortSignal.timeout(15000) });
  if (!site.ok || !(await site.text()).includes('집중할고양'))
    throw new Error('공개 체험판 주소를 먼저 점검하세요.');
  const picture = await fetch(draft.og_image, {
    method: 'HEAD',
    signal: AbortSignal.timeout(15000),
  });
  if (!picture.ok || !picture.headers.get('content-type')?.startsWith('image/'))
    throw new Error('대표 이미지가 열리지 않습니다.');
  // 요청 전에 파일을 독점 생성한다. 응답 유실 때도 자동 재제출하지 않는다.
  const fd = fs.openSync(receipt, 'wx', 0o600);
  fs.writeSync(fd, 'METAMOA_SUBMISSION_PENDING=1\n');
  fs.fsyncSync(fd);
  try {
    const response = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, agree: true }),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    // 키가 있는 원문은 권한 600 환경 파일에만 보관한다. 오류 응답도 콘솔에 찍지 않는다.
    fs.writeSync(fd, `METAMOA_RECEIPT_BASE64=${Buffer.from(raw).toString('base64')}\n`);
    fs.fsyncSync(fd);
    if (!response.ok)
      throw new Error(`접수 실패: HTTP ${response.status}. 환경 파일의 응답을 확인하세요.`);
    const result = JSON.parse(raw);
    if (
      typeof result.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(result.id) ||
      typeof result.request_key !== 'string' ||
      !/^mm_req_[A-Za-z0-9_-]+$/.test(result.request_key)
    ) {
      throw new Error(
        '접수 응답 형식이 예상과 다릅니다. 보관된 응답을 확인하고 재제출하지 마세요.',
      );
    }
    fs.writeSync(
      fd,
      `METAMOA_SUBMISSION_ID=${result.id}\nMETAMOA_REQUEST_KEY=${result.request_key}\n`,
    );
    fs.fsyncSync(fd);
    console.log(`등록 요청 접수 완료: ${result.id}. 키는 .env.metamoa에만 보관했습니다.`);
  } finally {
    fs.closeSync(fd);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
