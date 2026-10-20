const { chromium } = require('playwright'),
  fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '..');
const reviewUrl = process.env.GROMO_REVIEW_URL || 'http://127.0.0.1:18762/?review=1';
fs.mkdirSync(path.join(root, '.docs'), { recursive: true });
const routes = [
  'login',
  'character',
  'chooseIsland',
  'createIsland',
  'joinIsland',
  'approval',
  'guide',
  'home',
  'focusSetup',
  'focus',
  'rest',
  'focusResult',
  'hall',
  'stats',
  'manage',
  'members',
  'ledger',
  'construction',
  'board',
  'notice',
  'noticeEdit',
  'quest',
  'questEdit',
  'tower',
  'explore',
  'visit',
  'mail',
  'shop',
  'product',
  'orders',
  'boat',
  'profile',
  'settings',
  'wardrobe',
  'sound',
];
let scenarios = routes.map((route) => ({ route }));
for (const [route, tab] of [
  ['board', '공지'],
  ['stats', '스크린타임 기록'],
  ['tower', '섬 간 랭킹'],
  ['shop', '우리 섬 꾸미기'],
  ['shop', '우리 섬의 소리'],
  ['orders', '섬 공동 구매'],
])
  scenarios.push({ route, tab });
for (const detail of [
  'scarf',
  'flag',
  'sailboat',
  'cabinboat',
  'soda-theme',
  'strawberry-roof',
  'rain',
]) {
  scenarios.push({ route: 'product', detail });
  scenarios.push({ route: 'product', detail, owned: true });
}
scenarios.push({ route: 'questEdit', body: 'screen' });
scenarios.push({ route: 'home', stage: [] });
scenarios.push({ route: 'home', stage: ['hall'] });
scenarios.push({ route: 'construction', stage: ['hall', 'board'] });
if (process.env.REVIEW_ROUTES)
  scenarios = scenarios.filter((c) => process.env.REVIEW_ROUTES.split(',').includes(c.route));
const results = [],
  errors = [];
let cursor = 0;
(async () => {
  const b = await chromium.launch();
  async function worker() {
    const p = await b.newPage({ viewport: { width: 402, height: 790 } });
    const pageErrors = [];
    p.on('pageerror', (e) => {
      pageErrors.push(e.message);
      errors.push(e.message);
    });
    p.on('dialog', (d) => d.dismiss());
    p.setDefaultTimeout(5000);
    await p.clock.setFixedTime(new Date());
    async function setup(c) {
      // 이전 모달의 포커스 잠금·크래시가 다음 버튼 검수에 전파되지 않게 새 문서로 시작한다.
      await p.goto(reviewUrl);
      await p.waitForFunction(() => window.__gromoReview);
      await p.evaluate((c) => {
        const r = window.__gromoReview,
          s = r.fixture(true),
          i = s.islands[0];
        s.settings.reduceMotion = true;
        s.tutorial = { step: c.route === 'guide' ? 0 : 99 };
        s.focusGuideDone = c.route !== 'guide';
        s.owned =
          c.owned || c.route !== 'product' ? ['scarf', 'flag', 'sailboat', 'cabinboat'] : [];
        s.records = [
          {
            id: 'r',
            islandId: s.islandId,
            subject: '수학',
            seconds: 600,
            at: Date.now(),
            fish: 12,
            contributed: false,
          },
        ];
        s.lastResult = s.records[0];
        i.ledger = [{ id: 'l', text: '퀘스트 +10P', at: Date.now() }];
        i.contribution = 60;
        if (c.stage) i.buildings = c.stage;
        if (c.owned) i.sharedOwned.push('soda-theme', 'strawberry-roof', 'rain');
        s.orders = [
          {
            id: 'o1',
            product: 'scarf',
            islandId: s.islandId,
            price: 20,
            currency: 'fish',
            at: Date.now(),
          },
          {
            id: 'o2',
            product: 'soda-theme',
            islandId: s.islandId,
            price: 200,
            currency: 'points',
            at: Date.now(),
          },
        ];
        if (['focus', 'rest'].includes(c.route))
          s.session = {
            id: 'f',
            islandId: s.islandId,
            subject: '수학',
            target: 25,
            startedAt: Date.now(),
            seconds: 600,
            status: c.route === 'rest' ? 'paused' : 'active',
          };
        let detail =
          c.detail ||
          { quest: 'q-focus', notice: 'welcome', visit: 'strawberry', product: 'scarf' }[c.route] ||
          '';
        r.open(c.route, {
          state: s,
          detail,
          text: '새로운 이야기',
          body: c.body || (['questEdit'].includes(c.route) ? 'focus' : '함께 집중해요.'),
          tab: c.tab || '',
        });
      }, c);
      await p.waitForTimeout(350);
    }
    while (cursor < scenarios.length) {
      const c = scenarios[cursor++];
      await setup(c);
      let buttons = await p.getByRole('button').evaluateAll((es) =>
        es.map((e) => ({
          name: e.getAttribute('aria-label') || e.innerText,
          disabled: e.disabled || e.getAttribute('aria-disabled') === 'true',
        })),
      );
      if (!buttons.length) {
        results.push({ screen: c.route, result: 'failed', error: '조작 가능한 버튼이 없는 화면' });
        continue;
      }
      const seen = {};
      buttons = buttons.map((x) => ({ ...x, n: (seen[x.name] = (seen[x.name] ?? -1) + 1) }));
      for (const target of buttons) {
        await setup(c);
        const button = p.getByRole('button', { name: target.name, exact: true }).nth(target.n);
        const result = {
          screen: c.route,
          variant: c.tab || c.detail || c.stage?.join(',') || '',
          owned: !!c.owned,
          button: target.name,
          index: target.n,
        };
        try {
          if (await button.isDisabled()) {
            results.push({ ...result, result: 'disabled' });
            continue;
          }
          const errorCount = pageErrors.length;
          await button.click({ timeout: 1800 });
          await p.waitForTimeout(60);
          const confirm = p.getByRole('button', { name: '확인', exact: true });
          if (await confirm.count()) {
            await confirm.click({ timeout: 1800 });
            await p.waitForTimeout(80);
          }
          if (pageErrors.length > errorCount)
            throw new Error(pageErrors.slice(errorCount).join('\n'));
          results.push({
            ...result,
            result: 'clicked',
            route: await p.evaluate(() => window.__gromoReview.route),
          });
        } catch (e) {
          results.push({
            ...result,
            result: 'failed',
            error: e.message,
            debug: await p.evaluate(() => ({
              route: window.__gromoReview.route,
              text: document.body.innerText,
              hidden: [...document.querySelectorAll('[aria-hidden=true]')].map((e) => ({
                tag: e.tagName,
                id: e.id,
                text: e.innerText?.slice(0, 120),
              })),
            })),
          });
        }
      }
      console.log(
        'Reviewed ' + c.route + ' ' + (c.tab || c.detail || '') + ' (' + buttons.length + ')',
      );
    }
    await p.close();
  }
  try {
    await Promise.all([worker(), worker()]);
  } finally {
    await b.close();
  }
  fs.writeFileSync(
    root + '/.docs/all-button-review.json',
    JSON.stringify(
      {
        scenarios: scenarios.length,
        results,
        errors,
        summary: results.reduce((a, r) => ((a[r.result] = (a[r.result] || 0) + 1), a), {}),
      },
      null,
      2,
    ),
  );
  console.log(
    'FINAL ' +
      JSON.stringify(results.reduce((a, r) => ((a[r.result] = (a[r.result] || 0) + 1), a), {})),
  );
  if (errors.length || results.some((r) => r.result === 'failed')) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
