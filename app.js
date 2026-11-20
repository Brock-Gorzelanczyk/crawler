"use strict";
// never run inside someone else's frame (clickjacking): GitHub Pages cannot send a frame-ancestors header
if (window.top !== window.self) { try { window.top.location = window.location.href; } catch (e) { document.documentElement.innerHTML = ""; } }

// ---- Settings (see README.md) ----
// Where sign-ups go: the Google Apps Script web app URL. Until it is set, the form says so instead of failing silently.
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxHdsnal13aemM0TY9q9-XC2QKrVZQSOW1f_0dDlLeZuQCJOMs3L9LgKoj0UFtCmP0b/exec";
// Crawler Kit checkout: the Stripe Payment Link for the $50 product (https://buy.stripe.com/...).
const STRIPE_LINK = "https://buy.stripe.com/aFa7sL1cAcJSg7V6wNfMA01";
// Investor Edition checkout: the Stripe Payment Link for the $249 product.
const INVESTOR_LINK = "https://buy.stripe.com/6oU6oHf3qdNWbRF08pfMA02";
// the paid tiers: checkout link, price on the button, what the Sheet's tier column gets, what the email brings
const PAID = {
  founding: {link: STRIPE_LINK, price: "$50", sheet: "founding_checkout_started", what: "the files and the install guide", cls: "paid"},
  investor: {link: INVESTOR_LINK, price: "$249", sheet: "investor_checkout_started", what: "the files, the filled brain and the install guide", cls: "inv"}
};
// How soon a buyer gets the generic crawler after paying. Shown on the page.
const DELIVERY = "within 24 hours";
const CONSENT_TEXT = "I agree to get texts and emails from BMG Capital about the web crawler at the number and address above, including by automated means. Up to 4 msgs/month. Consent is not a condition of purchase. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

document.getElementById("yr").textContent = new Date().getFullYear();
const $ = id => document.getElementById(id);
const form = $("wl");

// ---- counts, not tracking: how many people the page reached and how far they got (the Sheet's Visits tab).
// Each event sends only its name and the ?src= tag. No phone, email, cookie, IP or device id; each counts once per page load.
const SRC = (new URLSearchParams(location.search).get("src") || (document.referrer ? (() => { try { return new URL(document.referrer).hostname; } catch (e) { return "direct"; } })() : "direct")).slice(0, 40);
const sentEv = {};
function ev(name){
  if (!ENDPOINT || sentEv[name]) return; sentEv[name] = 1;
  const body = new URLSearchParams({ev: name, source: SRC});
  try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; } catch (e) {}
  fetch(ENDPOINT, {method: "POST", mode: "no-cors", keepalive: true, headers: {"Content-Type": "application/x-www-form-urlencoded"}, body}).catch(() => {});
}
ev("visit");
if ("IntersectionObserver" in window) {
  const seen = new Map(), io = new IntersectionObserver(es => es.forEach(x => {
    const name = x.target.dataset.ev;
    if (x.isIntersecting) seen.set(name, setTimeout(() => { ev(name); io.unobserve(x.target); }, name === "form" ? 600 : 3000));   // a clip counts as seen after 3 s on screen
    else clearTimeout(seen.get(name));
  }), {threshold: 0.5});
  [["brain", "tour"], ["crawl", "crawl"], ["join", "form"]].forEach(([id, name]) => { const el = $(id); if (el) { el.dataset.ev = name; io.observe(el); } });
}
$("ship-line").textContent = DELIVERY;

// phones: the pinned "Get the crawler" button shows from the first screen and goes away once the sign-up card is on screen
(() => {
  const cta = $("cta"), card = $("join"); if (!cta || !card) return;
  let queued = false;
  const draw = () => { queued = false; cta.classList.toggle("off", card.getBoundingClientRect().top < innerHeight - 90); };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  addEventListener("scroll", ask, {passive: true}); addEventListener("resize", ask); draw();
  cta.addEventListener("click", e => { e.preventDefault(); card.scrollIntoView({behavior: "smooth", block: "start"}); });
})();

// the button and the pre-order terms follow the choice
const tier = () => (form.querySelector("input[name=tier]:checked") || {}).value || "waitlist";
function drawTier(){
  const t = PAID[tier()], btn = $("go");
  $("terms").classList.toggle("on", !!t);
  if (t) $("ship-what").textContent = t.what;
  btn.classList.toggle("paid", !!t && t.cls === "paid");
  btn.classList.toggle("inv", !!t && t.cls === "inv");
  btn.textContent = t ? "Continue to payment · " + t.price : "Join the waitlist";
}
form.addEventListener("change", e => { if (e.target.name === "tier") drawTier(); });
drawTier();

// US numbers: (555) 123-4567 as you type; stored as +15551234567
function digits(s){ return (s || "").replace(/\D/g, ""); }
function e164(raw){
  let d = digits(raw);
  if (/^\+/.test(raw.trim()) && !raw.trim().startsWith("+1")) return d.length >= 8 && d.length <= 15 ? "+" + d : null;   // non-US with country code
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 && /^[2-9]\d{2}[2-9]/.test(d) ? "+1" + d : null;
}
$("phone").addEventListener("input", e => {
  const v = e.target.value; if (v.trim().startsWith("+") && !v.trim().startsWith("+1")) return;
  let d = digits(v); if (d.length === 11 && d[0] === "1") d = d.slice(1); d = d.slice(0, 10);
  e.target.value = d.length > 6 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : d.length > 3 ? `(${d.slice(0,3)}) ${d.slice(3)}` : d;
  e.target.classList.remove("bad"); $("phone-hint").textContent = "";
});
$("email").addEventListener("input", e => { e.target.classList.remove("bad"); $("email-hint").textContent = ""; });
const okEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

form.addEventListener("submit", async e => {
  e.preventDefault();
  $("formerr").textContent = "";
  const phone = e164($("phone").value), email = $("email").value.trim().toLowerCase();
  let bad = false;
  if (!phone){ $("phone").classList.add("bad"); $("phone-hint").textContent = "Enter a 10-digit US number, or +country code."; bad = true; }
  if (!okEmail(email)){ $("email").classList.add("bad"); $("email-hint").textContent = "Enter a valid email."; bad = true; }
  if (!$("consent").checked){ $("formerr").textContent = "Tick the box to agree to texts and emails."; bad = true; }
  if (bad) return;
  if ($("company").value) { showDone(); return; }   // a bot filled the hidden field
  const t = PAID[tier()], paid = !!t;
  if (!ENDPOINT){ $("formerr").textContent = "Sign-ups aren't connected yet."; return; }
  if (paid && !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/.test(t.link)){ $("formerr").textContent = "That option isn't open yet. Join the free waitlist for now."; return; }

  const body = new URLSearchParams({
    phone, email,
    tier: paid ? t.sheet : "waitlist",
    consent: "yes", consent_text: CONSENT_TEXT,
    source: new URLSearchParams(location.search).get("src") || (document.referrer ? new URL(document.referrer).hostname : "direct"),
    page: location.href.split("?")[0],
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || ""
  });
  const btn = $("go"); btn.disabled = true; btn.textContent = paid ? "Opening checkout..." : "Joining...";
  try {
    // the contact is saved first, so someone who leaves checkout is still on the list.
    // Apps Script answers with a redirect that browsers block for reading; no-cors still delivers the row
    await fetch(ENDPOINT, {method: "POST", mode: "no-cors", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body});
    ev(paid ? "checkout" : "join");
    if (paid) {
      // no email or phone in the address: Stripe asks for both itself, and the Sheet's Paid tab matches buyers by email
      location.href = t.link;
      return;
    }
    showDone();
  } catch (err) {
    $("formerr").textContent = "Couldn't reach the server. Check your connection and try again.";
    btn.disabled = false; drawTier();
  }
});
function showDone(){ $("formwrap").style.display = "none"; $("done").classList.add("on"); }

// The two clips. The page ships each one as its poster image; this swaps in the moving version.
// iPhone and iPad: every browser there is WebKit, including the TikTok and Instagram in-app browsers, and those
// in-app browsers throw any playing <video> into the full-screen player (closing it just reopens it). So on iOS
// there is no <video> at all: the clip is an <img> whose source is the MP4, which WebKit plays like a GIF (muted,
// looping, inline, nothing to tap). If that image fails, an animated WebP.
// Everywhere else: a muted looping <video>. If it has not started after 4 s on screen (an in-app browser that
// blocks autoplay), or anything takes it full screen, the animated WebP replaces it.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const hasIO = "IntersectionObserver" in window;
// phones (the same width as the CSS rule that makes the tour's frame 9:16) play the tall 9:16 tour; wider screens the 16:9 one
if (matchMedia("(max-width: 760px)").matches) document.querySelectorAll("img[data-mp4-tall]").forEach(el => {
  el.dataset.mp4 = el.dataset.mp4Tall; el.dataset.webp = el.dataset.webpTall; if (el.dataset.posterTall) el.src = el.dataset.posterTall; });
const clips = Array.from(document.querySelectorAll("img[data-mp4]")).map(el => ({el, mp4: el.dataset.mp4, webp: el.dataset.webp, done: false}));

function swapIn(c, node) { node.className = c.el.className; node.id = c.el.id; c.el.replaceWith(node); c.el = node; }
function asImage(c, src, onfail) {                 // load off-page first, so the poster stays up until it is ready
  const i = new Image(); i.alt = c.el.getAttribute("alt") || c.el.getAttribute("aria-label") || ""; i.decoding = "async";
  i.onload = () => { if (i.naturalWidth) swapIn(c, i); else if (onfail) onfail(); };
  i.onerror = () => { if (onfail) onfail(); };
  i.src = src;
}
const toWebp = c => { if (c.done) return; c.done = true; asImage(c, c.webp); };

function asVideo(c) {
  const v = document.createElement("video");
  v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
  ["muted", "playsinline", "webkit-playsinline", "loop", "autoplay"].forEach(k => v.setAttribute(k, ""));
  v.preload = "auto"; v.poster = c.el.getAttribute("src"); v.setAttribute("aria-label", c.el.getAttribute("alt") || "");
  v.src = c.mp4; swapIn(c, v);
  let seen = 0, last = Date.now();
  const tryPlay = () => { v.muted = true; try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
  const visible = () => !hasIO || c.on;
  const bail = () => { try { if (document.fullscreenElement === v) document.exitFullscreen(); if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen(); } catch (e) {}
    v.pause(); toWebp(c); };
  v.addEventListener("webkitbeginfullscreen", bail);
  document.addEventListener("fullscreenchange", () => { if (document.fullscreenElement === v) bail(); });
  ["loadedmetadata", "canplay"].forEach(ev => v.addEventListener(ev, () => { if (visible() && v.paused) tryPlay(); }));
  const tick = setInterval(() => {
    if (c.el !== v) return clearInterval(tick);
    const now = Date.now(); if (visible()) seen += now - last; last = now;
    if (!visible()) { if (!v.paused) v.pause(); return; }
    if (v.paused) tryPlay();
    if (seen > 4000 && (v.paused || v.currentTime < 0.2)) { clearInterval(tick); toWebp(c); }
  }, 500);
  const unlock = () => { if (visible() && v.paused) tryPlay(); };
  document.addEventListener("touchend", unlock, {once: true, passive: true});
  document.addEventListener("click", unlock, {once: true});
  return v;
}

clips.forEach(c => {
  if (IOS) asImage(c, c.mp4, () => toWebp(c));
  else asVideo(c);
});
if (hasIO) {
  // watch the frames, which stay put while the clip inside them is swapped
  const frames = new Map(clips.map(c => [c.el.parentNode, c]));
  const io = new IntersectionObserver(es => es.forEach(e => { const c = frames.get(e.target); if (c) c.on = e.isIntersecting; }), {threshold: 0.25});
  frames.forEach((c, f) => io.observe(f));
}
