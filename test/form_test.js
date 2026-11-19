// End-to-end check of the waitlist form in Chromium, with the sign-up endpoint and Stripe stubbed.
//   python3 -m http.server 8765 (in the waitlist folder), then: node test/form_test.js
const { chromium } = (() => { try { return require('playwright'); } catch (e) {
  return require(process.env.HOME + '/.npm/_npx/86170c4cd1c5da32/node_modules/playwright'); } })();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const EP = 'https://script.google.com/macros/s/TEST/exec', STRIPE = 'https://buy.stripe.com/test_123';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  for (const vp of [{width: 390, height: 844, name: 'phone'}, {width: 1280, height: 860, name: 'desktop'}]) {
    const ctx = await b.newContext({viewport: vp});
    const posts = [], errs = [];
    await ctx.route(BASE + 'index.html*', async r => { const res = await r.fetch(); let t = await res.text();
      t = t.replace('const ENDPOINT = "";', `const ENDPOINT = "${EP}";`).replace('const STRIPE_LINK = "";', `const STRIPE_LINK = "${STRIPE}";`).replace('const SHIP_BY = "";', 'const SHIP_BY = "March 31, 2027";');
      r.fulfill({response: res, body: t}); });
    await ctx.route(EP, r => { posts.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); r.fulfill({status: 200, body: '{"ok":true}'}); });
    let stripeHit = null;
    await ctx.route(STRIPE + '**', r => { stripeHit = r.request().url(); r.fulfill({status: 200, contentType: 'text/html', body: '<h1>stripe stub</h1>'}); });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + 'index.html?src=tiktok');
    await p.screenshot({path: `test/shot-${vp.name}.png`, fullPage: true});
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${vp.name}: no sideways scroll`);

    // bad input stays on the page and sends nothing
    await p.fill('#phone', '123'); await p.fill('#email', 'nope'); await p.click('#go');
    ok(posts.length === 0 && /10-digit/.test(await p.textContent('#phone-hint')) && /valid email/.test(await p.textContent('#email-hint')), `${vp.name}: bad phone/email blocked`);
    await p.fill('#phone', '3125550188'); await p.fill('#email', 'Test.User@Example.com'); await p.click('#go');
    ok(posts.length === 0 && /Tick the box/.test(await p.textContent('#formerr')), `${vp.name}: consent required`);
    ok(await p.inputValue('#phone') === '(312) 555-0188', `${vp.name}: phone formats as typed`);

    // free waitlist
    await p.check('#consent'); await p.click('#go'); await p.waitForTimeout(400);
    const w = posts[0] || {};
    ok(w.phone === '+13125550188' && w.email === 'test.user@example.com' && w.tier === 'waitlist' && w.consent === 'yes' && w.source === 'tiktok' && /STOP/.test(w.consent_text), `${vp.name}: waitlist row ${JSON.stringify({phone: w.phone, email: w.email, tier: w.tier, source: w.source})}`);
    ok(await p.isVisible('#done'), `${vp.name}: thank-you shown`);

    // founding access: saves the contact, then goes to Stripe with the email and phone attached
    await p.goto(BASE + 'index.html?src=tiktok');
    await p.check('input[value=founding]');
    ok(/\$100/.test(await p.textContent('#go')) && await p.isVisible('#terms') && /March 31, 2027/.test(await p.textContent('#terms')), `${vp.name}: $100 button and pre-order terms shown`);
    await p.screenshot({path: `test/shot-${vp.name}-founding.png`});
    await p.fill('#phone', '+1 (646) 555-0123'); await p.fill('#email', 'buyer@example.com'); await p.check('#consent');
    await p.click('#go'); await p.waitForTimeout(800);
    const f = posts[1] || {};
    ok(f.tier === 'founding_checkout_started' && f.phone === '+16465550123', `${vp.name}: founding row saved before checkout`);
    ok(!!stripeHit && stripeHit.includes('prefilled_email=buyer%40example.com') && stripeHit.includes('client_reference_id=16465550123'), `${vp.name}: Stripe opened ${stripeHit}`);

    // a bot that fills the hidden field is not saved
    await p.goto(BASE + 'index.html'); await p.evaluate(() => document.getElementById('company').value = 'spam');
    await p.fill('#phone', '3125550199'); await p.fill('#email', 'bot@example.com'); await p.check('#consent'); await p.click('#go'); await p.waitForTimeout(300);
    ok(posts.length === 2, `${vp.name}: honeypot not saved`);
    ok(errs.length === 0, `${vp.name}: page errors ${JSON.stringify(errs)}`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
