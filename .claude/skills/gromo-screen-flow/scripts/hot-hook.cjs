// 캡처 하네스에 끼워 넣는 훅: 스크린샷을 찍을 때 그 화면의 "누를 수 있는 것" 자리를 같이 저장한다.
// 사용: node -r ./hot-hook.cjs capture/capture-<묶음>.cjs  → <png 경로>.hotspots.json
const Module = require('module');
const fs = require('fs');
const DUMP = () => {
  const out = [], seen = new Set();
  const vw = innerWidth, vh = innerHeight;
  const sel = '[tabindex="0"],[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],button,a[href],input,textarea';
  const push = (el) => {
    if (seen.has(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    if (!top || !(el.contains(top) || top === el)) return; // 다른 것에 가려진 버튼은 뺀다
    seen.add(el);
    out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80), label: el.getAttribute('aria-label') || '' });
  };
  document.querySelectorAll(sel).forEach(push);
  for (const el of document.querySelectorAll('div,span')) {
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    const par = el.parentElement;
    if (par && getComputedStyle(par).cursor === 'pointer') continue;
    push(el);
  }
  return out;
};
const patchPage = (page) => {
  const orig = page.screenshot.bind(page);
  page.screenshot = async (opt) => {
    if (opt && opt.path) {
      try { fs.writeFileSync(opt.path.replace(/\.png$/, '.hotspots.json'), JSON.stringify(await page.evaluate(DUMP))); } catch (e) { /* 자리 정보는 없어도 캡처는 계속 */ }
    }
    return orig(opt);
  };
  return page;
};
const patchContext = (ctx) => {
  const np = ctx.newPage.bind(ctx);
  ctx.newPage = async (...a) => patchPage(await np(...a));
  return ctx;
};
const origLoad = Module._load;
Module._load = function (request) {
  const m = origLoad.apply(this, arguments);
  if (/playwright$/.test(request) && m && m.chromium && !m.chromium.__hot) {
    m.chromium.__hot = true;
    const launch = m.chromium.launch.bind(m.chromium);
    m.chromium.launch = async (...a) => {
      const b = await launch(...a);
      const nc = b.newContext.bind(b), np = b.newPage.bind(b);
      b.newContext = async (...x) => patchContext(await nc(...x));
      b.newPage = async (...x) => patchPage(await np(...x));
      return b;
    };
  }
  return m;
};
