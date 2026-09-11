import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (password.length < 12 || password.length > 200) {
  console.error('비밀번호는 12~200자여야 합니다. 표준 입력으로 전달하세요.');
  process.exit(1);
}
const salt = randomBytes(16);
process.stdout.write(`${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}\n`);
