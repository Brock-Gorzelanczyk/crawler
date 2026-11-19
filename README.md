# Web crawler waitlist page

The TikTok bio landing page. A visitor leaves a phone number and an email, then picks one:

- **Join the waitlist (free)**: saved as `waitlist`.
- **Founding access ($50)**: the exact files for the crawler, its UI, the Obsidian brain and the 3D brain view, plus the build guide, no data. Saved on the Waitlist tab as "started $100 checkout" (the Sheet's label; the price is $50), then sent to Stripe checkout. Stripe-confirmed payments land on the **Paid** tab (pulled from Stripe every 10 minutes), and the buyer's Waitlist row changes to "paid".

Every contact goes into a Google Sheet you own, so someone who opens checkout and leaves is still on the list.

| File | What it is |
|---|---|
| `index.html` | The page (no inline script, so the Content-Security-Policy can block injected code) |
| `app.js` | The form logic. Three settings at the top: `ENDPOINT`, `STRIPE_LINK`, `DELIVERY` |
| `privacy.html` | Privacy notice the consent box links to. Contact: your Gmail |
| `apps-script/Code.gs` | Saves sign-ups to the Waitlist tab (one row per person) and pulls Stripe-confirmed payments into the Paid tab |
| `assets/` | The 7-second crawler loop (0.8 MB) and its poster frame |
| `test/form_test.js` | End-to-end check (22 checks, phone and desktop) |

## Setup (about 15 minutes, once)

### 1. The Google Sheet (where sign-ups land)

1. Create a new Google Sheet, for example "Crawler waitlist".
2. Open **Extensions > Apps Script**, delete what's there, and paste in all of `apps-script/Code.gs`. Save.
3. Click **Deploy > New deployment**. Pick type **Web app**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.

   Click Deploy and allow access when Google asks.
4. Copy the **Web app URL** (it ends in `/exec`). In `app.js`, set `const ENDPOINT = "<that URL>";`.

Two tabs:
- **Waitlist**: first_seen, last_seen, phone, email, tier (free / started $100 checkout / paid), source, sms_email_consent, consent_text, page, timezone, times_submitted.
- **Paid**: paid_at, name, email, phone, amount, currency, stripe_session, payment_link, delivered. Only Stripe writes here (via `syncPaid`), so nobody can add themselves without paying. Mark `delivered` yourself after you email the crawler.

Keep the Sheet private (don't share it); it holds phone numbers.

### 2. Stripe (the $50 founding access)

1. In Stripe, go to **Product catalog > Add product**: "Web Crawler: Founding Access", $50, one-time.
2. Go to **Payment Links > New**, using that product.
   - Turn on **Collect customers' phone numbers**.
   - Under After payment, set a confirmation message that repeats the ship-by date.
3. Copy the link (`https://buy.stripe.com/...`). In `app.js`, set `const STRIPE_LINK = "<link>";`.
4. In `app.js`, `const DELIVERY = "within 24 hours";` is the delivery promise shown on the page. Change it only if you can keep the new promise.

To fill the Paid tab:
1. Stripe > Developers > API keys > **Create restricted key**. Name it "Crawler sheet". Set **Checkout Sessions: Read**, everything else None. Create it.
2. In the Apps Script project: **Project Settings > Script properties > Add**: `STRIPE_KEY` = that `rk_...` key. Save. The key lives only there, never in this repo.
3. In the editor, pick `setup` and click **Run** (allow access if asked). It makes both tabs and checks Stripe every 10 minutes.

Test mode and live mode have separate links and keys. When you go live, swap both.

### 3. Put it online (free, GitHub Pages)

1. Create a new **public** GitHub repo, e.g. `crawler`. Keep it separate from the vault and the site repos.
2. Push this folder to it. Then go to **Settings > Pages**, set **Deploy from branch**, pick `main` and `/ (root)`.
3. The page is live at `https://<your-username>.github.io/crawler/`. Put that link in your TikTok bio, ideally with `?src=tiktok` on the end so the Sheet's `source` column shows where sign-ups came from.

You can point a custom domain at it later.

## Sending texts and emails later

Export the Sheet (File > Download > CSV) and import it into a texting tool (e.g. SimpleTexting, Twilio) and an email tool (e.g. Mailchimp, Beehiiv).

- **US texting:** marketing texts from a regular 10-digit number need A2P 10DLC registration, which the texting tool walks you through.
- **What the consent covers:** texts and emails about the web crawler, up to 4 a month. Stay inside that.
- **Opt-outs:** honor STOP right away.
- **Every email:** needs an unsubscribe link and a mailing address.

## Before you launch

- [ ] `ENDPOINT` and the **live** `STRIPE_LINK` set in `app.js`; live `STRIPE_KEY` in Script properties.
- [ ] Test rows deleted from the Waitlist tab.
- [ ] Contact email set in `privacy.html`.
- [ ] One real test sign-up on your phone shows up in the Sheet.
- [ ] One test payment in Stripe test mode, then switch the link to live mode.
- [ ] The generic crawler is built and ready to email, so every buyer gets it within the `DELIVERY` promise.

## Test

```bash
cd ~/crawler-waitlist && python3 -m http.server 8765 --bind 127.0.0.1
```

```bash
cd ~/crawler-waitlist && node test/form_test.js
```
