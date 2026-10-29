<script setup lang="ts">
/**
 * Campaign detail (mock) — Paper design 75.
 *
 * Reads `:id` from the route and looks it up in the mock fixtures. If
 * the fixture is a `scheduled`/`draft` row the campaign has no metrics,
 * so we fall back to a scoped empty state. The real version will pull
 * from an analytics endpoint keyed on `batch_id` from bulkEmail.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { findCampaign, type CampaignRecipient } from './mockCampaigns'

const route = useRoute()
const router = useRouter()

const campaignId = computed(() => String(route.params.id ?? ''))
const campaign = computed(() => findCampaign(campaignId.value))

type ActivityFilter = 'all' | 'opened' | 'clicked' | 'did_not_open'
const activityFilter = ref<ActivityFilter>('all')
const unitMode = ref<'numbers' | 'percentage'>('numbers')

const activityCounts = computed(() => {
  const r = campaign.value?.recipients ?? []
  return {
    all: campaign.value?.delivered ?? r.length,
    opened: campaign.value?.opens ?? r.filter((x) => x.status === 'opened' || x.status === 'clicked').length,
    clicked: campaign.value?.clicks ?? r.filter((x) => x.status === 'clicked').length,
    did_not_open:
      (campaign.value?.delivered ?? r.length) -
      (campaign.value?.opens ?? r.filter((x) => x.status === 'opened' || x.status === 'clicked').length),
  }
})

const filteredRecipients = computed<CampaignRecipient[]>(() => {
  const r = campaign.value?.recipients ?? []
  switch (activityFilter.value) {
    case 'opened':       return r.filter((x) => x.status === 'opened' || x.status === 'clicked')
    case 'clicked':      return r.filter((x) => x.status === 'clicked')
    case 'did_not_open': return r.filter((x) => x.status === 'delivered' || x.status === 'bounced')
    default:             return r
  }
})

function back() {
  router.push({ name: 'communications' })
}

function recipientChipClass(status: CampaignRecipient['status']): string {
  return `chip chip--${status}`
}
</script>

<template>
  <div v-if="campaign" class="cd">
    <!-- Back + bulk actions rail -->
    <div class="cd__rail">
      <button type="button" class="cd__back" @click="back">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M8 2L4 6l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        All campaigns
      </button>
      <div class="cd__actions">
        <button type="button" class="cd__icon-btn" title="Duplicate">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 2.5h7v7h-7z M4.5 4.5h7v7h-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="cd__icon-btn" title="Archive">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 1h5l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 1v3h3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="cd__btn cd__btn--ghost">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5l3-3 3 3M6 1.5v8M2 10h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Export CSV
        </button>
        <button type="button" class="cd__btn cd__btn--ink">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 6l4 4M5 10V2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Resend to non-openers
        </button>
      </div>
    </div>

    <!-- Header card -->
    <header class="cd__header">
      <div class="cd__header-meta">
        <span class="pill pill--sent">{{ campaign.status }}</span>
        <span>Broadcast · {{ campaign.audience_label }}</span>
      </div>
      <h1>{{ campaign.subject }}</h1>
      <div class="cd__header-foot">
        <div class="cd__author">
          <div class="cd__author-avatar">{{ campaign.author_initials }}</div>
          <span>{{ campaign.author_name }}</span>
        </div>
        <span class="cd__dot">·</span>
        <span>Sent <strong>{{ campaign.sent_at_time }}</strong></span>
      </div>
    </header>

    <!-- 5-up stat row with hero Opens tile -->
    <section class="cd__stats">
      <article class="bigstat">
        <header>
          <span class="bigstat__label">Delivered</span>
          <span class="bigstat__trend bigstat__trend--success">100%</span>
        </header>
        <div class="bigstat__value">{{ campaign.delivered }}<span class="bigstat__frac">/ {{ campaign.audience_count }}</span></div>
        <footer>All messages accepted by SES</footer>
      </article>

      <article class="bigstat bigstat--hero">
        <header>
          <span class="bigstat__label">Unique opens</span>
          <span class="bigstat__trend bigstat__trend--sky">▲ +12 vs avg</span>
        </header>
        <div class="bigstat__value">{{ campaign.open_rate }}<span class="bigstat__unit">%</span></div>
        <footer><strong>{{ campaign.opens }}</strong> of {{ campaign.delivered }} recipients opened</footer>
      </article>

      <article class="bigstat">
        <header>
          <span class="bigstat__label">Clicks</span>
          <span class="bigstat__trend bigstat__trend--success">▲ +5 pp</span>
        </header>
        <div class="bigstat__value">{{ campaign.click_rate }}<span class="bigstat__unit">%</span></div>
        <footer><strong>{{ campaign.clicks }}</strong> clicks on {{ campaign.links?.length ?? 0 }} links</footer>
      </article>

      <article class="bigstat">
        <header>
          <span class="bigstat__label">Bounces</span>
          <span class="bigstat__trend">0.0%</span>
        </header>
        <div class="bigstat__value">{{ campaign.bounces ?? 0 }}</div>
        <footer>No hard bounces or complaints</footer>
      </article>

      <article class="bigstat">
        <header>
          <span class="bigstat__label">Unsubscribed</span>
          <span class="bigstat__trend">0.7%</span>
        </header>
        <div class="bigstat__value">{{ campaign.unsubscribes ?? 0 }}</div>
        <footer v-if="(campaign.unsubscribes ?? 0) > 0">A. Patel opted out of broadcasts</footer>
        <footer v-else>No one opted out</footer>
      </article>
    </section>

    <!-- Funnel + top links -->
    <section class="cd__row">
      <article class="card funnel">
        <header class="card__head">
          <div class="card__title-wrap">
            <div class="card__eyebrow">Delivery funnel</div>
            <h2 class="card__title">{{ campaign.delivered }} → {{ campaign.clicks }} over 4 days</h2>
          </div>
          <div class="toggle">
            <button
              type="button"
              class="toggle__btn"
              :class="{ 'toggle__btn--active': unitMode === 'numbers' }"
              @click="unitMode = 'numbers'"
            >Numbers</button>
            <button
              type="button"
              class="toggle__btn"
              :class="{ 'toggle__btn--active': unitMode === 'percentage' }"
              @click="unitMode = 'percentage'"
            >Percentage</button>
          </div>
        </header>
        <ul class="funnel__list">
          <li class="funnel__row">
            <div class="funnel__label">Sent</div>
            <div class="funnel__track"><div class="funnel__fill funnel__fill--ink" style="width: 100%;">100%</div></div>
            <div class="funnel__value">{{ campaign.audience_count }}</div>
          </li>
          <li class="funnel__row">
            <div class="funnel__label">Delivered</div>
            <div class="funnel__track"><div class="funnel__fill funnel__fill--graphite" style="width: 100%;">100%</div></div>
            <div class="funnel__value">{{ campaign.delivered }}</div>
          </li>
          <li class="funnel__row">
            <div class="funnel__label">Opened</div>
            <div class="funnel__track"><div class="funnel__fill funnel__fill--accent" :style="{ width: `${campaign.open_rate}%` }">{{ campaign.open_rate }}%</div></div>
            <div class="funnel__value">{{ campaign.opens }}</div>
          </li>
          <li class="funnel__row">
            <div class="funnel__label">Clicked</div>
            <div class="funnel__track"><div class="funnel__fill funnel__fill--sky" :style="{ width: `${campaign.click_rate}%` }">{{ campaign.click_rate }}%</div></div>
            <div class="funnel__value">{{ campaign.clicks }}</div>
          </li>
          <li class="funnel__row funnel__row--muted">
            <div class="funnel__label">Bounced</div>
            <div class="funnel__track"><div class="funnel__fill funnel__fill--empty" style="width: 1%;"></div></div>
            <div class="funnel__value funnel__value--muted">{{ campaign.bounces ?? 0 }}</div>
          </li>
        </ul>
      </article>

      <article class="card links">
        <header class="card__head card__head--stacked">
          <div class="card__eyebrow">Top links</div>
          <h2 class="card__title">{{ campaign.links?.length ?? 0 }} links · {{ campaign.clicks }} clicks</h2>
        </header>
        <ul class="links__list">
          <li v-for="lnk in campaign.links ?? []" :key="lnk.url" class="links__row">
            <div class="links__top">
              <div class="links__url">{{ lnk.url }}</div>
              <div class="links__clicks">{{ lnk.clicks }}</div>
            </div>
            <div class="links__bar">
              <div class="links__bar-fill" :style="{ width: `${(lnk.clicks / (campaign.links![0]?.clicks ?? 1)) * 100}%` }"></div>
            </div>
          </li>
        </ul>
        <div v-if="campaign.device_split" class="devices">
          <div class="card__eyebrow">Device split</div>
          <div class="devices__bar">
            <div class="devices__seg devices__seg--mobile" :style="{ width: `${campaign.device_split.mobile}%` }"></div>
            <div class="devices__seg devices__seg--desktop" :style="{ width: `${campaign.device_split.desktop}%` }"></div>
            <div class="devices__seg devices__seg--tablet" :style="{ width: `${campaign.device_split.tablet}%` }"></div>
          </div>
          <div class="devices__legend">
            <span><strong>{{ campaign.device_split.mobile }}%</strong> Mobile</span>
            <span><strong>{{ campaign.device_split.desktop }}%</strong> Desktop</span>
            <span><strong>{{ campaign.device_split.tablet }}%</strong> Tablet</span>
          </div>
        </div>
      </article>
    </section>

    <!-- Activity table + preview -->
    <section class="cd__row cd__row--activity">
      <article class="card activity">
        <header class="activity__head">
          <div class="card__title-wrap">
            <div class="card__eyebrow">Recipient activity</div>
            <h2 class="card__title">{{ campaign.delivered }} recipients</h2>
          </div>
          <div class="chips">
            <button
              type="button"
              class="chip-tab"
              :class="{ 'chip-tab--active': activityFilter === 'all' }"
              @click="activityFilter = 'all'"
            >All <span>{{ activityCounts.all }}</span></button>
            <button
              type="button"
              class="chip-tab"
              :class="{ 'chip-tab--active': activityFilter === 'opened' }"
              @click="activityFilter = 'opened'"
            >Opened <span>{{ activityCounts.opened }}</span></button>
            <button
              type="button"
              class="chip-tab"
              :class="{ 'chip-tab--active': activityFilter === 'clicked' }"
              @click="activityFilter = 'clicked'"
            >Clicked <span>{{ activityCounts.clicked }}</span></button>
            <button
              type="button"
              class="chip-tab"
              :class="{ 'chip-tab--active': activityFilter === 'did_not_open' }"
              @click="activityFilter = 'did_not_open'"
            >Didn't open <span>{{ activityCounts.did_not_open }}</span></button>
          </div>
        </header>

        <div class="activity__table-head">
          <div>Recipient</div>
          <div>Status</div>
          <div>Last activity</div>
          <div class="activity__r">Clicks</div>
        </div>
        <ul class="activity__list">
          <li
            v-for="r in filteredRecipients"
            :key="r.user_id"
            class="activity__row"
          >
            <div class="activity__person">
              <div class="activity__avatar" :class="`activity__avatar--${r.avatar_tone}`">{{ r.initials }}</div>
              <div>
                <div class="activity__name">{{ r.name }}</div>
                <div class="activity__email">{{ r.email }}</div>
              </div>
            </div>
            <div>
              <span :class="recipientChipClass(r.status)">
                {{ r.status.charAt(0).toUpperCase() + r.status.slice(1) }}
              </span>
            </div>
            <div class="activity__when">
              <div>{{ r.last_activity_label }}</div>
              <div class="activity__when-sub">{{ r.last_activity_detail }}</div>
            </div>
            <div class="activity__r activity__clicks" :class="{ 'activity__clicks--empty': r.clicks === 0 }">
              {{ r.clicks === 0 && r.status !== 'clicked' ? '—' : r.clicks }}
            </div>
          </li>
          <li v-if="filteredRecipients.length === 0" class="activity__empty">
            No recipients in this bucket.
          </li>
        </ul>
        <footer class="activity__foot">
          <div>Showing {{ filteredRecipients.length }} of {{ campaign.delivered }} recipients</div>
          <button type="button" class="cd__btn cd__btn--chip">
            Load all {{ campaign.delivered }}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 4L5 6.5 7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </footer>
      </article>

      <aside class="card preview">
        <header class="preview__head">
          <div class="card__title-wrap">
            <div class="card__eyebrow">What they got</div>
            <h2 class="card__title">Email preview</h2>
          </div>
          <button type="button" class="cd__icon-btn" title="Open in new tab">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5h5v5h-5zM8 2v3M11 2h-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </header>
        <div class="preview__subject">
          <div class="card__eyebrow">Subject</div>
          <div>{{ campaign.subject }}</div>
        </div>
        <div class="preview__body">
          <div class="preview__brand">Naenae Bowling Club</div>
          <div class="preview__divider"></div>
          <p
            v-for="(line, i) in campaign.body_lines ?? []"
            :key="i"
            class="preview__line"
            v-html="line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')"
          ></p>
          <div v-if="campaign.cta_label" class="preview__cta">{{ campaign.cta_label }}</div>
          <div class="preview__divider"></div>
          <div class="preview__meta">Naenae Bowling Club · 25 Vogel Street, Naenae<br>Unsubscribe anytime from your profile.</div>
        </div>
        <div class="preview__footer-meta">
          <div><span>Template</span><span>Broadcast · default</span></div>
          <div><span>Reply-to</span><span class="mono">grace@naenaebowls.nz</span></div>
          <div><span>Sender</span><span class="mono">members@naenaebowls.nz</span></div>
        </div>
      </aside>
    </section>
  </div>

  <!-- Not-found or no-metrics fallback -->
  <div v-else class="cd__empty">
    <h1>Campaign not found</h1>
    <p>No campaign matches "<code>{{ campaignId }}</code>" in the current fixtures.</p>
    <button type="button" class="cd__btn cd__btn--ink" @click="back">Back to all campaigns</button>
  </div>
</template>

<style scoped>
.cd {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 32px 48px;
  max-width: 1440px;
}

/* ── Rail ──────────────────────────────────────────────────────── */
.cd__rail { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.cd__back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
  cursor: pointer;
}
.cd__back:hover { background: var(--color-hairline); }
.cd__actions { display: flex; align-items: center; gap: 10px; }
.cd__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  cursor: pointer;
}
.cd__icon-btn:hover { background: var(--color-surface); }
.cd__btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.cd__btn--ghost { background: #fff; border: 1px solid var(--color-hairline); color: var(--color-ink); font-weight: 500; }
.cd__btn--ghost:hover { background: var(--color-surface); }
.cd__btn--ink { background: var(--color-ink); color: #fff; padding: 0 16px; }
.cd__btn--ink:hover { background: var(--color-graphite); }
.cd__btn--chip {
  height: 34px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  color: var(--color-ink);
  font-weight: 500;
  padding: 0 16px;
}

/* ── Header card ──────────────────────────────────────────────── */
.cd__header {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px 36px 28px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
}
.cd__header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-fog);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.pill--sent { background: #DCFCE7; color: #166534; }
.cd__header h1 {
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: 500;
  color: var(--color-ink);
  letter-spacing: -0.03em;
  line-height: 100%;
  margin: 0;
  max-width: 900px;
}
.cd__header-foot {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.cd__header-foot strong { color: var(--color-ink); font-weight: 500; }
.cd__dot { color: #CCCCCC; }
.cd__author { display: inline-flex; align-items: center; gap: 8px; }
.cd__author-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
}
.cd__author span:last-child { color: var(--color-ink); font-weight: 500; }

/* ── Big stat row ─────────────────────────────────────────────── */
.cd__stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: var(--color-hairline);
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
  overflow: hidden;
}
.bigstat {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 20px;
  padding: 28px 28px 24px;
  background: #fff;
  min-height: 180px;
}
.bigstat header { display: flex; align-items: center; justify-content: space-between; }
.bigstat__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-fog);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.bigstat__trend { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.bigstat__trend--success { color: var(--color-success); }
.bigstat__trend--sky { color: var(--color-sky-1); }
.bigstat__value {
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: 500;
  color: var(--color-ink);
  letter-spacing: -0.03em;
  line-height: 100%;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.bigstat__unit { font-size: 20px; color: var(--color-mute); font-weight: 500; letter-spacing: 0; }
.bigstat__frac { font-family: var(--font-mono); font-size: 12px; color: var(--color-mute); font-weight: 400; letter-spacing: 0; }
.bigstat footer { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.bigstat footer strong { color: var(--color-ink); font-weight: 600; }

.bigstat--hero {
  background: var(--color-ink);
  color: #fff;
}
.bigstat--hero .bigstat__label { color: rgba(255, 255, 255, 0.7); }
.bigstat--hero .bigstat__value { font-size: 56px; }
.bigstat--hero .bigstat__unit { color: rgba(255, 255, 255, 0.65); font-size: 24px; }
.bigstat--hero footer { color: rgba(255, 255, 255, 0.7); }
.bigstat--hero footer strong { color: #fff; }

/* ── Shared card ──────────────────────────────────────────────── */
.cd__row { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: start; }
.card {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
}
.card__head { display: flex; align-items: center; justify-content: space-between; padding: 28px 28px 0; }
.card__head--stacked { flex-direction: column; align-items: flex-start; gap: 4px; }
.card__title-wrap { display: flex; flex-direction: column; gap: 4px; }
.card__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-fog);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.card__title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 500;
  color: var(--color-ink);
  letter-spacing: -0.02em;
  margin: 0;
}

/* Toggle inside funnel header */
.toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: var(--color-surface);
}
.toggle__btn {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fog);
  cursor: pointer;
}
.toggle__btn--active {
  background: #fff;
  color: var(--color-ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(10, 10, 11, 0.08);
}

/* ── Funnel ───────────────────────────────────────────────────── */
.funnel { padding-bottom: 28px; }
.funnel__list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px 28px 0;
  margin: 0;
  list-style: none;
}
.funnel__row {
  display: grid;
  grid-template-columns: 110px 1fr 90px;
  gap: 16px;
  align-items: center;
}
.funnel__label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
}
.funnel__row--muted .funnel__label { color: var(--color-fog); }
.funnel__track {
  position: relative;
  height: 36px;
  border-radius: 10px;
  background: var(--color-surface);
  overflow: hidden;
}
.funnel__fill {
  height: 100%;
  border-radius: 10px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  color: #fff;
  font-family: var(--font-mono);
  font-size: 12px;
}
.funnel__fill--ink { background: var(--color-ink); }
.funnel__fill--graphite { background: var(--color-graphite); }
.funnel__fill--accent { background: var(--color-accent); }
.funnel__fill--sky { background: var(--color-sky-1); color: var(--color-ink); }
.funnel__fill--empty { background: var(--color-hairline); }
.funnel__value {
  text-align: right;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--color-ink);
}
.funnel__value--muted { color: var(--color-mute); }

/* ── Links ────────────────────────────────────────────────────── */
.links { padding: 28px; display: flex; flex-direction: column; gap: 20px; }
.links__list { display: flex; flex-direction: column; gap: 14px; list-style: none; padding: 0; margin: 0; }
.links__row { display: flex; flex-direction: column; gap: 6px; }
.links__top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.links__url {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.links__clicks { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); flex-shrink: 0; }
.links__bar { height: 3px; border-radius: 999px; background: var(--color-surface); overflow: hidden; }
.links__bar-fill { height: 100%; background: var(--color-ink); border-radius: 999px; }

.devices { display: flex; flex-direction: column; gap: 10px; padding-top: 16px; border-top: 1px solid var(--color-hairline); }
.devices__bar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--color-surface); }
.devices__seg--mobile { background: var(--color-ink); }
.devices__seg--desktop { background: var(--color-fog); }
.devices__seg--tablet { background: #CCCCCC; }
.devices__legend {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
}
.devices__legend strong { color: var(--color-ink); font-weight: 600; }

/* ── Activity ────────────────────────────────────────────────── */
.activity { overflow: hidden; }
.activity__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 18px;
  flex-wrap: wrap;
}
.chips { display: flex; align-items: center; gap: 6px; }
.chip-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-ink);
  cursor: pointer;
}
.chip-tab:hover:not(.chip-tab--active) { background: var(--color-surface); }
.chip-tab--active { background: var(--color-ink); color: #fff; font-weight: 600; }
.chip-tab span { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); }
.chip-tab--active span { color: rgba(255, 255, 255, 0.65); }

.activity__table-head,
.activity__row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 110px;
  align-items: center;
  gap: 16px;
  padding: 10px 24px;
}
.activity__table-head {
  background: #FAFAF8;
  border-top: 1px solid var(--color-hairline);
  border-bottom: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  color: var(--color-fog);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.activity__r { text-align: right; }
.activity__list { list-style: none; padding: 0; margin: 0; }
.activity__row { padding: 14px 24px; border-bottom: 1px solid var(--color-hairline); }
.activity__row:last-child { border-bottom: 0; }
.activity__person { display: flex; align-items: center; gap: 12px; min-width: 0; }
.activity__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: #fff;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.activity__avatar--ink { background: var(--color-ink); }
.activity__avatar--graphite { background: var(--color-graphite); }
.activity__avatar--fog { background: var(--color-fog); }
.activity__name { font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-ink); }
.activity__email { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.activity__when { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.activity__when-sub { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.activity__clicks { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.activity__clicks--empty { font-family: var(--font-body); font-size: 13px; font-weight: 400; color: var(--color-mute); }

.activity__empty { padding: 40px 24px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.activity__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #FAFAF8;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}

/* Recipient status chips */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
}
.chip--clicked { background: #DBEAFE; color: #1E40AF; }
.chip--opened { background: #DCFCE7; color: #166534; }
.chip--delivered { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); font-weight: 500; }
.chip--bounced { background: #FEE2E2; color: #991B1B; }
.chip--unsubscribed { background: #FEE2E2; color: #991B1B; }

/* ── Preview rail ─────────────────────────────────────────────── */
.preview { overflow: hidden; display: flex; flex-direction: column; }
.preview__head { display: flex; align-items: center; justify-content: space-between; padding: 22px 24px 16px; }
.preview__subject {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  margin: 0 24px;
  border-radius: 12px;
  background: var(--color-surface);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink);
  line-height: 1.3;
}
.preview__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  margin: 14px 24px 0;
  border-radius: 12px;
  border: 1px solid var(--color-hairline);
}
.preview__brand { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.01em; }
.preview__divider { height: 1px; background: var(--color-hairline); }
.preview__line { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.6; margin: 0; }
.preview__cta {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  width: fit-content;
}
.preview__meta { font-family: var(--font-body); font-size: 10px; color: var(--color-mute); line-height: 1.6; }
.preview__footer-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  margin: 14px 24px 24px;
  border-radius: 12px;
  border: 1px dashed var(--color-hairline);
}
.preview__footer-meta div { display: flex; justify-content: space-between; align-items: center; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.preview__footer-meta div span:last-child { color: var(--color-ink); font-weight: 500; }
.preview__footer-meta .mono { font-family: var(--font-mono); }

/* ── Empty ────────────────────────────────────────────────────── */
.cd__empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  padding: 48px 32px;
}
.cd__empty h1 { font-family: var(--font-display); font-size: 32px; color: var(--color-ink); margin: 0; }
.cd__empty p { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); }
.cd__empty code { font-family: var(--font-mono); font-size: 13px; padding: 2px 6px; background: var(--color-surface); border-radius: 4px; }

@media (max-width: 1180px) {
  .cd__stats { grid-template-columns: repeat(2, 1fr); }
  .cd__row { grid-template-columns: 1fr; }
}
</style>
