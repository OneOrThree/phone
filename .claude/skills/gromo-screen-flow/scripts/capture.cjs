// gromo 2.0 웹 빌드 화면 캡처기 — scripts/capture-phone-screens.cjs 를 지금 코드에 맞게 고친 스크래치 사본.
// 실행: node capture.cjs            (환경변수는 아래 참고)
//   CAPTURE_CONFIG  화면 목록 파일 (기본 ./shots-probe.cjs)
//   CAPTURE_OUT     출력 폴더 (기본 ../shots-probe)
//   CAPTURE_URL     웹 서버 주소 (기본 http://127.0.0.1:18762/?review=1)
//   CAPTURE_SCALE   배율 (기본 2 → 804×1748)
//   CAPTURE_IDS     쉼표로 고른 id 만 찍기
//   CAPTURE_SAFE_AREA  "위,아래" pt — 아이폰 안전영역(노치·홈바 여백) 흉내. 기본 62,34 (iPhone 16 Pro). 끄려면 0,0
//   CAPTURE_LOGIN_PROVIDERS  웹 빌드는 소셜 로그인 버튼이 없다. 기본 kakao,google 을 브라우저 안에서만 끼워 넣는다. 끄려면 none
const { chromium } = require(require('path').join(process.env.GROMO_APP || require('path').join(require('os').homedir(), 'soma/phone/app/app-dev'), 'node_modules/playwright'));
const fs = require('fs');
const path = require('path');

const URL_ = process.env.CAPTURE_URL || 'http://127.0.0.1:18762/?review=1';
if (!process.env.CAPTURE_CONFIG || !process.env.CAPTURE_OUT) {
  console.error('CAPTURE_CONFIG(화면 목록 파일)와 CAPTURE_OUT(출력 폴더)을 환경변수로 주세요. 예시 목록: capture-example.cjs');
  process.exit(1);
}
const OUT = path.resolve(process.env.CAPTURE_OUT);
const SCALE = Number(process.env.CAPTURE_SCALE || 2);
const SAFE = (process.env.CAPTURE_SAFE_AREA || '62,34').split(',').map(Number);
const PROVIDERS = (process.env.CAPTURE_LOGIN_PROVIDERS || 'kakao,google').split(',');
const only = process.env.CAPTURE_IDS ? process.env.CAPTURE_IDS.split(',') : null;
const shots = require(path.resolve(process.env.CAPTURE_CONFIG));
fs.mkdirSync(OUT, { recursive: true });

// 섬 낮/밤은 기기 시각(06~18시 낮)으로 정해진다. Date 만 일정하게 밀어 원하는 시각으로 고정한다
// (타이머·애니메이션은 건드리지 않는다).
const shiftClock = (hour) => {
  const Real = Date;
  const target = new Real();
  target.setHours(hour, 0, 0, 0);
  const off = target.getTime() - Real.now();
  class Shifted extends Real {
    constructor(...a) {
      a.length ? super(...a) : super(Real.now() + off);
    }
    static now() {
      return Real.now() + off;
    }
  }
  window.Date = Shifted;
};

// 브라우저 안에서 실행: 목업 상태를 만들고 원하는 route 로 바로 연다.
const openShot = (c) => {
  const r = window.__gromoReview;
  const s = r.fixture(!c.fresh);
  const is = s.islands[0];
  s.name = c.name ?? '오스카';
  s.settings.reduceMotion = false;
  s.screenMinutes = 84;
  if (c.fresh) {
    s.loggedIn = true;
    s.onboarded = true;
  }
  if (c.stage) {
    is.buildings =
      c.stage === 'hall-ready' ? [] : c.stage === 'board-ready' ? ['hall'] : ['hall', 'board'];
    is.contribution = c.stage === 'hall-ready' ? 20 : c.stage === 'board-ready' ? 40 : 0;
  }
  if (c.noPermission) s.settings.permission = false;
  if (c.pending) {
    s.pendingIslands = [c.pending];
    s.pendingIsland = c.pending;
  }
  // 펠리컨(우체통)·강아지(상점) 첫 안내는 기본으로 '이미 봄' 처리. npcGuide: true 면 안내가 뜬 상태를 찍는다.
  if (!c.npcGuide) {
    s.mailboxGuideSeenBy = ['local'];
    s.shopGuideSeenBy = ['local'];
  }
  // records: false 면 집중 기록 없이(= 퀘스트 달성 보상 팝업 없이) 연다
  if (!c.fresh && c.records !== false) {
    s.records = Array.from({ length: 7 }, (_, i) => ({
      id: 'r' + i,
      islandId: s.islandId,
      subject: ['수학 문제 풀기', '영어 단어', '책 읽기'][i % 3],
      seconds: [1800, 2700, 1200, 3600, 2100, 900, 3000][i],
      at: Date.now() - i * 86400000,
      fish: 6,
      contributed: false,
    }));
    s.lastResult = s.records[0];
  }
  if (c.owned) {
    s.owned = ['scarf'];
    s.equipped = { ...s.equipped, clothes: 'scarf' };
  }
  if (c.session)
    s.session = {
      id: 'session',
      islandId: s.islandId,
      subject: '수학 문제 풀기',
      target: 40,
      startedAt: Date.now(),
      seconds: 1230,
      status: c.paused ? 'paused' : 'active',
    };
  is.playing = !!c.session;
  // 임의 상태: mutate 는 (state, 현재 섬) 을 받는 함수의 소스 문자열
  if (c.mutate) new Function('s', 'is', `(${c.mutate})(s, is)`)(s, is);
  r.open(c.route, {
    detail: c.detail,
    tab: c.tab,
    text: c.text,
    body: c.body,
    travel: c.travel,
    failNext: c.failNext,
    // 99 = 첫 안내(몽돌 튜토리얼) 끝난 상태. 0~21 을 주면 그 튜토리얼 단계를 찍는다.
    guideStep: c.guideStep ?? 99,
    state: s,
  });
};

async function runStep(p, step) {
  if (step.wait) return p.waitForTimeout(step.wait);
  if (step.click) {
    // 접근성 이름(버튼) 우선, 없으면 보이는 글자
    const btn = p.getByRole('button', { name: step.click, exact: true });
    const target = (await btn.count()) ? btn : p.getByText(step.click, { exact: true });
    return target.nth(step.nth || 0).click();
  }
  if (step.label) return p.getByLabel(step.label, { exact: true }).nth(step.nth || 0).click();
  if (step.fill) return p.getByLabel(step.fill[0]).nth(step.nth || 0).fill(step.fill[1]);
  if (step.tap) return p.mouse.click(step.tap[0], step.tap[1]);
  if (step.waitText) return p.getByText(step.waitText).first().waitFor();
  if (step.dispatch) return p.evaluate((a) => window.__gromoReview.dispatch(a), step.dispatch);
  if (step.scroll === 'bottom')
    return p.evaluate(() => {
      for (const el of document.querySelectorAll('div'))
        if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY === 'auto')
          el.scrollTop = el.scrollHeight;
    });
  if (step.js) return p.evaluate(step.js);
  if (step.zoom) {
    // 지도 확대·축소: [x, y, deltaY] — ctrl+휠(앱이 웹에서 받는 핀치 대용). 음수 = 확대.
    // CDP 터치 핀치는 브라우저 화면 전체를 확대해 버리고 다음 장까지 남으므로 쓰지 않는다.
    await p.mouse.move(step.zoom[0], step.zoom[1]);
    await p.keyboard.down('Control');
    await p.mouse.wheel(0, step.zoom[2]);
    return p.keyboard.up('Control');
  }
  if (step.drag) {
    // 지도 끌기: [x1, y1, x2, y2]
    const [x1, y1, x2, y2] = step.drag;
    await p.mouse.move(x1, y1);
    await p.mouse.down();
    await p.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
    await p.mouse.move(x2, y2, { steps: 5 });
    return p.mouse.up();
  }
  throw new Error('모르는 step: ' + JSON.stringify(step));
}

(async () => {
  const todo = shots
    .map((c, i) => ({ id: String(i + 1).padStart(3, '0'), hour: c.night ? 22 : 14, ...c }))
    .filter((c) => !only || only.includes(c.id))
    .map((c) => ({ ...c, mutate: c.mutate ? c.mutate.toString() : undefined }));
  const browser = await chromium.launch();
  const catalog = [];
  const errors = [];
  const t0 = Date.now();
  // 낮 화면과 밤 화면은 페이지를 따로 띄운다(시각을 중간에 바꾸면 진행 중 애니메이션이 꼬인다)
  for (const hour of [...new Set(todo.map((c) => c.hour))]) {
    const ctx = await browser.newContext({
      viewport: { width: 402, height: 874 },
      deviceScaleFactor: SCALE,
      locale: 'ko-KR',
    });
    ctx.setDefaultTimeout(5000);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push({ hour, message: e.message }));
    await p.addInitScript(shiftClock, hour);
    if (SAFE.length === 2) {
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: SAFE[0], bottom: SAFE[1] },
      });
    }
    // 웹에서는 loginProviders() 가 빈 목록이라 로그인 화면에 소셜 버튼이 안 나온다.
    // 받아 오는 번들의 그 한 줄만 바꿔 기기와 같은 버튼을 그린다(파일은 건드리지 않는다).
    if (PROVIDERS[0] !== 'none')
      await p.route('**/_expo/static/js/web/*.js', async (route) => {
        const res = await route.fetch();
        const body = (await res.text())
          .replace(
            /loginProviders:\w+\.TERMS_VERSION\?\(0,\w+\.loginProviders\)\(\):\[\]/,
            'loginProviders:' + JSON.stringify(PROVIDERS),
          )
          // 누를 수 있는 상태(약관 동의 후 버튼 활성)를 그리려면 핸들러가 있어야 한다 — 아무 일도 안 하는 함수로
          .replace(
            /startSocial:!\w+\.TERMS_VERSION\|\|\w+\|\|\w+\?void 0:\w+/,
            'startSocial:()=>{}',
          );
        await route.fulfill({ response: res, body });
      });
    await p.goto(URL_);
    await p.waitForFunction(() => window.__gromoReview, null, { timeout: 30000 });
    // 브라우저 전용 파란 포커스 테두리(자동 포커스된 버튼)를 지운다 — 기기에는 없는 모양
    await p.addStyleTag({ content: '*:focus,*:focus-visible{outline:none!important}' });
    for (const c of todo.filter((x) => x.hour === hour)) {
      const started = Date.now();
      let failed = '';
      try {
        await p.evaluate(openShot, c);
        await p.waitForTimeout(c.delay || 450);
        for (const step of c.steps || []) {
          await runStep(p, step);
          await p.waitForTimeout(step.settle ?? 250);
        }
        // 이미지 디코딩과 폰트 로딩이 끝난 뒤 찍는다
        await p.evaluate(async () => {
          await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
          await document.fonts.ready;
        });
      } catch (e) {
        failed = String(e.message).split('\n')[0];
      }
      const file = `${c.id}-${c.name_ || c.route}${failed ? '-FAILED' : ''}.png`;
      await p.screenshot({ path: path.join(OUT, file) });
      const info = await p.evaluate(() => ({
        route: window.__gromoReview.route,
        text: document.body.innerText,
      }));
      const ms = Date.now() - started;
      catalog.push({ id: c.id, title: c.title, file, route: c.route, actualRoute: info.route, ms, failed, text: info.text });
      console.log(
        `${c.id} ${ms}ms ${c.title}` +
          (failed ? `  !! 실패: ${failed}` : '') +
          (info.route !== (c.expectRoute || c.route) ? `  !! route=${info.route}` : '') +
          (info.text.trim().length < 2 ? '  !! 화면에 글자 없음' : ''),
      );
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 2));
  console.log(
    `${catalog.length}장 · 총 ${((Date.now() - t0) / 1000).toFixed(1)}초 · 실패 ${catalog.filter((c) => c.failed).length} · 페이지 에러 ${errors.length} → ${OUT}`,
  );
})();
