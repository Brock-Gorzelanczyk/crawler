# Web crawler waitlist page

The TikTok bio landing page. A visitor leaves a phone number and an email, then picks one:

- **Join the waitlist (free)**: saved as `waitlist`.
- **Founding access ($100)**: saved as `founding_checkout_started`, then sent to Stripe checkout with their email filled in.

Every contact goes into a Google Sheet you own, so someone who opens checkout and leaves is still on the list.

| File | What it is |
|---|---|
| `index.html` | The page. Three settings at the top of its `<script>`: `ENDPOINT`, `STRIPE_LINK`, `SHIP_BY` |
| `privacy.html` | Privacy notice the consent box links to. Put your contact email in it before launch |
| `apps-script/Code.gs` | Saves sign-ups to the Sheet: one row per person, so repeats update the row instead of adding a copy |
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
4. Copy the **Web app URL** (it ends in `/exec`). In `index.html`, set `const ENDPOINT = "<that URL>";`.

The first sign-up creates a `Signups` tab with these columns: first_seen, last_seen, phone, email, tier, paid, source, sms_email_consent, consent_text, page, timezone, times_submitted.

### 2. Stripe (the $100 founding access)

1. In Stripe, go to **Product catalog > Add product**: "Web Crawler: Founding Access", $100, one-time.
2. Go to **Payment Links > New**, using that product.
   - Turn on **Collect customers' phone numbers**.
   - Under After payment, set a confirmation message that repeats the ship-by date.
3. Copy the link (`https://buy.stripe.com/...`). In `index.html`, set `const STRIPE_LINK = "<link>";`.
4. In `index.html`, set `const SHIP_BY = "<date>";`: the date you promise founding access ships by. The page shows it with the refund promise.

To see who paid: each Stripe payment has **client_reference_id** set to the buyer's phone digits (e.g. `16465550123`), which matches the Sheet's phone column. Mark `paid` = yes on those rows.

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

- [ ] `ENDPOINT`, `STRIPE_LINK` and `SHIP_BY` set in `index.html`.
- [ ] Contact email set in `privacy.html`.
- [ ] One real test sign-up on your phone shows up in the Sheet.
- [ ] One test payment in Stripe test mode, then switch the link to live mode.
- [ ] You're ready to deliver founding access by `SHIP_BY`, or to refund everyone who paid.

## Test

```bash
cd ~/crawler-waitlist && python3 -m http.server 8765 --bind 127.0.0.1
```

```bash
cd ~/crawler-waitlist && node test/form_test.js
```
