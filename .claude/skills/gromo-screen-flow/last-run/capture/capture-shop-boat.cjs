// [shop-boat 묶음 전용 사본] capture.cjs 와 다른 점:
//   1) 번들 패치 3줄 추가 — 서버 모드 전용 UI(설정의 안전 섹션, 차단한 사용자 화면)를 목업에서 연다
//      옵션 serverUi: true → 설정에 안전 섹션 표시 + blockedUsers route 허용
//      옵션 blocks: [{id,name}] | 'error' → GET /blocks 응답 흉내
//   3) 옵션 after: ms → 찍은 뒤 다음 장까지 기다림(진행 중인 전환 연출이 끝나게)
//   4) 옵션 reload: true → 이 장을 찍기 전에 페이지를 새로 띄움(앞 장의 지도·전환 상태를 지움)
//   5) 옵션 external: 'https://…' → 앱이 외부 브라우저로 여는 주소를 같은 크기 새 탭에서 찍음
//   2) 옵션 burst: [장수, 간격ms] → steps 뒤 연속으로 여러 장(_burst/ 폴더) — 전환 연출의 프레임 고르기용
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
const OUT = path.resolve(process.env.CAPTURE_OUT || path.join(__dirname, '../shots/shop-boat'));
const SCALE = Number(process.env.CAPTURE_SCALE || 2);
const SAFE = (process.env.CAPTURE_SAFE_AREA || '62,34').split(',').map(Number);
const PROVIDERS = (process.env.CAPTURE_LOGIN_PROVIDERS || 'kakao,google').split(',');
const only = process.env.CAPTURE_IDS ? process.env.CAPTURE_IDS.split(',') : null;
const shots = require(path.resolve(process.env.CAPTURE_CONFIG || path.join(__dirname, 'cfg-shop-boat.cjs')));
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
  window.__serverUi = !!c.serverUi;
  window.__blocksMock = c.blocks
    ? () => (c.blocks === 'error' ? Promise.reject(new Error('mock')) : Promise.resolve(c.blocks))
    : null;
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
          )
          // [shop-boat] 차단한 사용자 화면: 서버 모드(e.islands) 조건을 검수 스위치로도 통과
          .replace("'blockedUsers'===r&&e.islands?", "'blockedUsers'===r&&(e.islands||window.__serverUi)?")
          // [shop-boat] GET /blocks 를 브라우저 안 흉내 응답으로
          .replace(
            "e.getBlockedUsers=function(){return(0,t.request)('/blocks')}",
            "e.getBlockedUsers=function(){return window.__blocksMock?window.__blocksMock():(0,t.request)('/blocks')}",
          )
          // [shop-boat] 설정의 '안전' 섹션(서버 모드 전용)
          .replace(
            /\),(\w+)\?(\(0,\w+\.jsxs\)\(\w+\.Fragment,\{children:\[\w+\('\\uc548\\uc804'\))/,
            '),($1||window.__serverUi)?$2',
          );
        await route.fulfill({ response: res, body });
      });
    const boot = async () => {
      await p.goto(URL_);
      await p.waitForFunction(() => window.__gromoReview, null, { timeout: 30000 });
      // 브라우저 전용 파란 포커스 테두리(자동 포커스된 버튼)를 지운다 — 기기에는 없는 모양
      await p.addStyleTag({ content: '*:focus,*:focus-visible{outline:none!important}' });
    };
    await boot();
    for (const c of todo.filter((x) => x.hour === hour)) {
      const started = Date.now();
      // [shop-boat] 앱 밖 브라우저로 여는 화면(약관 원문 등): 같은 크기의 새 탭에서 그 주소를 열어 찍는다
      if (c.external) {
        const q = await ctx.newPage();
        let failedExt = '';
        try {
          await q.goto(c.external, { waitUntil: 'networkidle', timeout: 30000 });
          await q.evaluate(() => document.fonts.ready);
        } catch (e) {
          failedExt = String(e.message).split('\n')[0];
        }
        const fileExt = `${c.id}-${c.name_ || c.route}${failedExt ? '-FAILED' : ''}.png`;
        await q.screenshot({ path: path.join(OUT, fileExt) });
        const textExt = await q.evaluate(() => document.body.innerText).catch(() => '');
        catalog.push({ id: c.id, title: c.title, file: fileExt, route: c.route, actualRoute: q.url(), ms: Date.now() - started, failed: failedExt, text: textExt });
        console.log(`${c.id} ${Date.now() - started}ms ${c.title} (외부: ${q.url()})` + (failedExt ? `  !! 실패: ${failedExt}` : ''));
        await q.close();
        continue;
      }
      let failed = '';
      try {
        // [shop-boat] 걸어서 건물에 들어간 뒤에는 홈 지도 상태가 남는다 → 새로 띄운 페이지에서 찍는다
        if (c.reload) await boot();
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
      if (c.burst) {
        const dir = path.join(OUT, '_burst');
        fs.mkdirSync(dir, { recursive: true });
        const b0 = Date.now();
        for (let i = 0; i < c.burst[0]; i++) {
          await p.screenshot({ path: path.join(dir, `${c.id}-${c.name_ || c.route}-f${String(i).padStart(2, '0')}-${Date.now() - b0}ms.png`) });
          await p.waitForTimeout(c.burst[1]);
        }
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
      // [shop-boat] 전환 연출 도중에 찍은 장은 연출이 끝난 뒤 다음 장으로 넘어간다(안 그러면 다음 장이 가려진다)
      if (c.after) await p.waitForTimeout(c.after);
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
