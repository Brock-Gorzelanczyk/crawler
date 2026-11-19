// The two clips on phones. WebKit with an iPhone profile: no <video> may ever exist (in-app browsers like TikTok's
// throw a playing video full screen), the clip is a moving image. Chromium: a muted inline video; if autoplay is
// blocked or something takes it full screen, the animated WebP replaces it. No tap ever opens anything.
//   python3 -m http.server 8765 --bind 127.0.0.1, then: node test/clip_test.js   (BASE=https://... for the live page)
const pw = (() => { try { return require('playwright'); } catch (e) { return require(process.env.HOME + '/.npm/_npx/86170c4cd1c5da32/node_modules/playwright'); } })();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const local = !BASE.startsWith('https');
async function page(browser, ctxOpts, init) {
  const ctx = await browser.newContext(ctxOpts);
  // http://127.0.0.1 has no https, so the page's upgrade-insecure-requests would break every image in WebKit locally
  if (local) await ctx.route(BASE + 'index.html*', async r => { const res = await r.fetch(); r.fulfill({response: res, body: (await res.text()).replace('; upgrade-insecure-requests', '')}); });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e)));
  await ctx.addInitScript(() => { window.__videos = 0; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeName === 'VIDEO') window.__videos++; }))).observe(document, {childList: true, subtree: true}); });
  await p.goto(BASE + 'index.html?src=tiktok&nc=' + Date.now());
  return p;
}
const moving = async (p, id) => { const el = p.locator('#' + id); await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(700);
  const a = await el.screenshot(); await p.waitForTimeout(1200); const b = await el.screenshot(); return !a.equals(b); };
const swapped = (p, id) => p.waitForFunction(id => document.getElementById(id).tagName === 'IMG', id, {timeout: 20000}).catch(() => {});
const info = (p, id) => p.evaluate(id => { const e = document.getElementById(id); return {tag: e.tagName, src: (e.currentSrc || e.src || '').replace(/^.*\//, '').slice(0, 40), paused: e.paused, fs: !!(document.fullscreenElement || e.webkitDisplayingFullscreen)}; }, id);

(async () => {
  const iphone = pw.devices['iPhone 13'];
  // 1. iPhone (WebKit): moving images, never a <video>, taps do nothing
  { const b = await pw.webkit.launch(); const p = await page(b, {...iphone});
    await p.waitForTimeout(2500);
    for (const id of ['crawl', 'brain']) {
      const mv = await moving(p, id), i = await info(p, id);
      ok(i.tag === 'IMG' && /\.mp4/.test(i.src) && mv, `iPhone ${id}: plays as a moving image ${JSON.stringify(i)} moving=${mv}`);
      const box = await p.locator('#' + id).boundingBox(); await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(800);
      const j = await info(p, id); ok(j.tag === 'IMG' && !j.fs && await moving(p, id), `iPhone ${id}: a tap opens nothing, still moving`);
    }
    ok(await p.evaluate(() => window.__videos === 0 && !document.querySelector('video')), 'iPhone: no video player ever on the page');
    await p.screenshot({path: (process.env.SHOTS || 'test') + '/clip-iphone.png'});
    // the MP4-as-image fails: the WebP takes over
    const p2 = await page(b, {...iphone});
    await p2.route('**/*.mp4*', r => r.abort()); await p2.reload(); await p2.waitForTimeout(4000);
    for (const id of ['crawl', 'brain']) { const i = await info(p2, id); ok(i.tag === 'IMG' && /\.webp/.test(i.src) && await moving(p2, id), `iPhone, MP4 image fails, ${id}: WebP plays ${JSON.stringify(i)}`); }
    ok(!p.errs.length && !p2.errs.length, 'iPhone: no page errors ' + JSON.stringify(p.errs.concat(p2.errs)));
    await b.close(); }

  // 2. Android-like (Chromium): inline video; blocked autoplay or forced full screen falls back to the WebP
  { const b = await pw.chromium.launch(); const android = pw.devices['Pixel 7'];
    const p = await page(b, {...android}); await p.waitForTimeout(2500);
    for (const id of ['crawl', 'brain']) { await p.locator('#' + id).scrollIntoViewIfNeeded(); await p.waitForTimeout(1500); const i = await info(p, id); ok(i.tag === 'VIDEO' && !i.paused && await moving(p, id), `Android ${id}: inline video plays ${JSON.stringify(i)}`); }
    const p2 = await page(b, {...android}, () => { HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); };
      Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', {get() { return false; }, set() {}});
      const sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function (k, v) { if (this instanceof HTMLMediaElement && k === 'autoplay') return; return sa.call(this, k, v); }; });
    await swapped(p2, 'crawl');   // 4 s on screen without playing, then the WebP downloads (about 10 MB)
    let i = await info(p2, 'crawl'); ok(i.tag === 'IMG' && /\.webp/.test(i.src) && await moving(p2, 'crawl'), `Android, autoplay blocked: crawler falls back to WebP ${JSON.stringify(i)}`);
    await p2.locator('#brain').scrollIntoViewIfNeeded(); await swapped(p2, 'brain');
    i = await info(p2, 'brain'); ok(i.tag === 'IMG' && /\.webp/.test(i.src) && await moving(p2, 'brain'), `Android, autoplay blocked: brain falls back to WebP ${JSON.stringify(i)}`);
    const p3 = await page(b, {...android}); await p3.waitForTimeout(2000);
    await p3.evaluate(() => { const x = document.createElement('button'); x.id = 'fsx'; x.textContent = 'fs'; x.style.cssText = 'position:fixed;top:0;left:0;z-index:99'; x.onclick = () => document.getElementById('crawl').requestFullscreen().catch(() => {}); document.body.append(x); });
    await p3.click('#fsx'); await p3.waitForTimeout(1500);
    i = await info(p3, 'crawl'); ok(i.tag === 'IMG' && !i.fs && /\.webp/.test(i.src), `Android, something forces full screen: back inline as WebP ${JSON.stringify(i)}`);
    ok(!p.errs.length && !p2.errs.length && !p3.errs.length, 'Android: no page errors');
    await b.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
