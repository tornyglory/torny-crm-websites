# Torny OS — subscription & signup: what we're trying to do

**This brief is the context memo** that sits above briefs 86/87/88. Those three cover the wire-level API shapes; this one describes the product we're building, why it matters, and the admin's point of view. If anything in 86/87/88 feels unclear or over-prescribed, this is the document that explains the intent — feel free to deviate on implementation as long as the admin experience + the outcomes below are preserved.

---

## 1. The problem today

Torny OS started as "a CRM for bowls clubs." Signup was gated — admins found their club in a pre-populated directory (seeded from Bowls NZ), submitted a claim, waited for support to approve, then got in. That shape doesn't work anymore for three reasons:

- **The product has outgrown bowls.** Venue hire, events, memberships, member comms — the feature set is useful to any organisation that runs a space or a community, not just sports clubs.
- **The claim/approve bottleneck is manual.** Support has to touch every new club.
- **Nothing monetises.** Every club is free. We need a revenue model.

Three briefs (86, 87, 88) together solve all three. This memo is the product frame.

---

## 2. What we're building

A **self-serve signup flow** at `torny.co` where any organisation — from a bowls club to a town hall to a holiday park — can create an account in under five minutes, land on a free 30-day trial of the full Pro experience, and start publishing their site + taking bookings the same day.

Afterward, the tier they're on (Starter $39 / Pro $79 per month) shapes what the CRM lets them do. Non-payment downgrades to Starter automatically; Stripe handles the money.

### Three product shifts captured

1. **From "club" to "organisation."** The product broadens — ten categories at signup, defaults driven by what makes sense for each.
2. **From "claim pre-existing" to "create fresh."** Admins type their org name + pick a slug + go. No directory lookup, no support queue.
3. **From "free forever for every club" to "two-tier subscription with a 30-day card-required trial."** Torny becomes a sustainable business.

---

## 3. Who's it for

The ten categories the admin picks from at signup:

| Category | Default plan | Why |
|---|---|---|
| Sports & recreation | Pro | Tournaments, team selections, honour boards — the originals |
| Community & civic (town hall, RSA, church, Rotary, residents assoc) | Pro | Venue hire is their core activity |
| Holiday accommodation (B&B, lodge, holiday park) | Pro | Venue bookings = the whole business |
| Events & function venue (weddings, conferences) | Pro | Venue bookings = the whole business |
| Fitness & wellness (gym, yoga, martial arts) | Starter | Memberships + comms core; bookings are optional |
| Arts & culture (theatre, choir, dance studio) | Starter | Memberships + events core |
| Youth groups (Scouts, Guides, cadets) | Starter | Memberships + comms core |
| Hospitality (pub, bar, restaurant) | Starter | Events + website core |
| Non-profit / charity | Starter | Memberships + comms core |
| Other | Starter | Default; they can upgrade if needed |

The admin can ignore the default and pick either tier — the preselection is guidance, not enforcement.

---

## 4. The admin's story (walk-through)

Imagine Sarah, treasurer of a small town hall in the Wairarapa. She's been running her events on a spreadsheet + an Outlook mailing list for a decade. She hears about Torny from a friend, lands on `torny.co`, and wants her town hall's booking page live before the committee meeting next week.

Here's what happens:

**Step 1 — Who are you?** Sarah types her name, work email, and a password. 20 seconds.

**Step 2 — About your place.** Sarah types "Carterton Community Hall." The slug auto-suggests `carterton-community-hall`, backend checks it's available, ticks green. Sarah picks her country (defaults to NZ), timezone (NZ auto-picked), and clicks "Community & civic" from the 10 category cards. 30 seconds.

**Step 3 — Pick your plan.** Sarah sees Starter ($39) and Pro ($79) side-by-side. Pro has a "Recommended for you" tag because her category needs venue hire. She clicks Continue on Pro. 15 seconds.

**Step 4 — Save your card.** Sarah is told she won't be charged today — the card is captured now so her site keeps running the day the trial ends. She clicks through to Stripe-hosted Checkout, enters her card, lands back on the welcome screen. 45 seconds (mostly Stripe).

**Welcome.** Sarah sees "Carterton Community Hall is live" with a 4-step checklist (upload logo, invite committee, first venue package, import members from CSV). Her public site is already running at `carterton-community-hall.torny.co` with the default template.

**Total time:** ~3 minutes. Sarah's not blocked on anything until she wants to do something — she has a working site immediately.

The next 29 days she uses the CRM like a paying customer with full Pro access. On day 27 she gets an email ("Trial ends in 3 days — $79 on Dec 9"). On day 31 Stripe charges her $79 and a receipt lands. She can downgrade to Starter or cancel from Settings → Billing any time.

---

## 5. What success looks like

Rough measurable outcomes once this ships:

- **A stranger can go from `torny.co` landing page → signed up → first venue package published in under 10 minutes** without talking to anyone.
- **Zero support touch on 90%+ of signups.** Email verification, Stripe handling, trial reminders — all automated.
- **Admins know within 30 seconds whether their plan picks the features they need.** The category + default-plan matrix + the plan-comparison cards do that work.
- **Downgrade is painless.** Settings → Billing → Downgrade → confirm. No chat required.
- **An abandoned Stripe checkout doesn't cost the admin anything.** They can resume from Settings → Billing whenever.

Negative outcomes to avoid:

- An admin typing their card at step 4 and never getting into the product. (Stripe reliability + good error states matter.)
- Support getting flooded with "I'm on Pro but I can't see X" questions because feature gating is confusing. (Brief 86's allowlist semantics should be obvious.)
- Clubs grandfathered from the pre-OS era getting silently downgraded or feeling punished. (They're on free Starter forever — no change, no forced upgrade.)

---

## 6. What stays, what goes

### Stays

- Every club that exists today — their data, their admins, their public site. Zero migration pain.
- The public club directory (`torny.co/directory` or similar) — still useful as a "find your local club" surface. It just stops being the admin signup funnel.
- The pre-populated bowls-directory clubs that haven't been claimed. They remain searchable in the directory but no longer gate signup.

### Goes

- The "claim your club" flow in the CRM — the view, the api-client resource, the backend endpoints. 30-day sunset with deprecation headers so in-flight claims can resolve.
- Every manual-approval step support has been doing at signup.

---

## 7. The underlying briefs

This memo is the product frame. For implementation detail:

| Brief | Topic | What it covers |
|---|---|---|
| 86 | Plan tiers + feature gating | The data model (`clubs.plan`), what features Starter vs Pro unlocks, the server-side allowlist, the status endpoint, superadmin manual-flip for edge cases |
| 87 | Stripe subscriptions | Everything that touches money: Stripe Customer, subscription lifecycle, trial, portal, status webhooks, derivation of `clubs.plan` from `subscription_status` |
| 88 | Public signup flow | The atomic `POST /public/signup` the wizard calls, slug availability check, retire the old claim flow |

Those three together are the full backend story. If one of them says "do X this exact way" and you see a cleaner path that still delivers the admin experience above, take the cleaner path — flag it in review and we'll update the briefs to match.

---

## 8. Open questions worth checking with the backend

Not blockers — just places where we'd like your input before locking the shape:

1. **Transactional integrity across user + org + Stripe.** The wizard pretends it's one click. If Stripe times out after the user + org inserts commit, what's the cleanest rollback story? We sketched DB-transaction wrap in brief 88 but you may have a better pattern.
2. **Idempotency table design.** Brief 88 mentions reusing brief 72's `stripe_events` ledger for signup idempotency; if that's a bad fit, name a better home.
3. **Email verification timing.** We're currently saying "verification happens async, not a blocker to signup." Fine for product, but if it causes issues for bulk-email reputation, call it out and we can require verification before campaigns go out.
4. **Rate limiting on public endpoints.** `POST /public/signup` and the slug-availability check will see bot traffic. Standard IP-rate-limit, CAPTCHA, or something else? Your call.

---

## 9. Contact

Felicity for product + wizard design. Technical questions on specific endpoint shapes: see briefs 86/87/88. Big-picture "should we even be doing this" questions: ping Felicity. Timeline is aggressive — brief 86 and 87 unblock internal dog-fooding; brief 88 is what admins can actually use.
