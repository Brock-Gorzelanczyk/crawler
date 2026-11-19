"use strict";
// never run inside someone else's frame (clickjacking): GitHub Pages cannot send a frame-ancestors header
if (window.top !== window.self) { try { window.top.location = window.location.href; } catch (e) { document.documentElement.innerHTML = ""; } }

// ---- Settings (see README.md) ----
// Where sign-ups go: the Google Apps Script web app URL. Until it is set, the form says so instead of failing silently.
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxHdsnal13aemM0TY9q9-XC2QKrVZQSOW1f_0dDlLeZuQCJOMs3L9LgKoj0UFtCmP0b/exec";
// Founding access checkout: the Stripe Payment Link for the $50 product (https://buy.stripe.com/...).
const STRIPE_LINK = "https://buy.stripe.com/aFa7sL1cAcJSg7V6wNfMA01";
// How soon a buyer gets the generic crawler after paying. Shown on the page.
const DELIVERY = "within 24 hours";
const CONSENT_TEXT = "I agree to get texts and emails from BMG Capital about the web crawler at the number and address above, including by automated means. Up to 4 msgs/month. Consent is not a condition of purchase. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

document.getElementById("yr").textContent = new Date().getFullYear();
const $ = id => document.getElementById(id);
const form = $("wl");
$("ship-line").textContent = DELIVERY;

// the button and the pre-order terms follow the choice
const tier = () => (form.querySelector("input[name=tier]:checked") || {}).value || "waitlist";
function drawTier(){
  const paid = tier() === "founding", btn = $("go");
  $("terms").classList.toggle("on", paid);
  btn.classList.toggle("paid", paid);
  btn.textContent = paid ? "Continue to payment · $50" : "Join the waitlist";
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
  const paid = tier() === "founding";
  if (!ENDPOINT){ $("formerr").textContent = "Sign-ups aren't connected yet."; return; }
  if (paid && !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/.test(STRIPE_LINK)){ $("formerr").textContent = "Founding access isn't open yet. Join the free waitlist for now."; return; }

  const body = new URLSearchParams({
    phone, email,
    tier: paid ? "founding_checkout_started" : "waitlist",
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
    if (paid) {
      // no email or phone in the address: Stripe asks for both itself, and the Sheet's Paid tab matches buyers by email
      location.href = STRIPE_LINK;
      return;
    }
    showDone();
  } catch (err) {
    $("formerr").textContent = "Couldn't reach the server. Check your connection and try again.";
    btn.disabled = false; drawTier();
  }
});
function showDone(){ $("formwrap").style.display = "none"; $("done").classList.add("on"); }

// Videos: play while on screen, muted and inline. A big file can take a few seconds to buffer on a
// phone, so while a video is on screen and not moving we quietly ask again every 1.5 s. The first tap
// anywhere on the page also starts them (allowed even where autoplay is blocked). No buttons.
const vids = Array.from(document.querySelectorAll("video[data-zoom]"));
const onScreen = new Set();
const hasIO = "IntersectionObserver" in window;
const visible = v => !hasIO || onScreen.has(v);
function tryPlay(v) {
  v.muted = true;
  try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
vids.forEach(v => {
  v.muted = true; v.defaultMuted = true; v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
  ["loadedmetadata", "canplay", "canplaythrough"].forEach(ev => v.addEventListener(ev, () => { if (visible(v) && v.paused) tryPlay(v); }));
});
setInterval(() => vids.forEach(v => { if (visible(v) && v.paused) tryPlay(v); }), 1500);
const unlock = () => vids.forEach(v => { if (visible(v)) tryPlay(v); });
document.addEventListener("touchend", unlock, {once: true, passive: true});
document.addEventListener("click", unlock, {once: true});
if (hasIO) {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { onScreen.add(e.target); tryPlay(e.target); } else { onScreen.delete(e.target); e.target.pause(); }
  }), {threshold: 0.25});
  vids.forEach(v => io.observe(v));
} else vids.forEach(tryPlay);
