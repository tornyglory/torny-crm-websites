#!/usr/bin/env bash
#
# Seed the Naenae Bowling Club (club_id 5) with three venue packages so
# the full booking flow works end-to-end. Matches the hard-coded
# packages the `/venue-hire/book` page fallback ships (book.vue).
#
# Usage:
#
#   # 1. Grab your admin JWT from the CRM.
#   #    In DevTools console on https://nae-nae-bowling-club.torny.co
#   #    (or your local http://localhost:5174 if signed in):
#   #    copy(localStorage.getItem('torny.token'))
#   #
#   # 2. Run:
#   #    TORNY_TOKEN='eyJ...' bash scripts/seed-naenae-packages.sh
#   #
#   # 3. (optional) Delete afterwards:
#   #    for id in <ids from output>; do
#   #      curl -X DELETE -H "Authorization: Bearer $TORNY_TOKEN" \
#   #        "$VENUE/clubs/5/venue-packages/$id"
#   #    done
#
# The script is idempotent-ish: `(club_id, slug)` is unique, so
# re-running will 409 on existing packages. It'll keep going and tell
# you which conflicted.

set -euo pipefail

VENUE="${VENUE_BASE_URL:-https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod}"
CLUB_ID="${CLUB_ID:-5}"

if [[ -z "${TORNY_TOKEN:-}" ]]; then
  echo "error: TORNY_TOKEN env var is required." >&2
  echo "see the usage block at the top of this script." >&2
  exit 1
fi

# One POST per package. Response is logged as a compact line: id + slug
# + slot_count + addon_count so you can see what landed.
post_package() {
  local label="$1"
  local payload="$2"
  echo "──────────────────────────────────────────"
  echo "creating: $label"
  local http_code body
  body=$(curl -s -o /tmp/vp-response.json -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $TORNY_TOKEN" \
    -H "Content-Type: application/json" \
    "$VENUE/clubs/$CLUB_ID/venue-packages" \
    -d "$payload")
  http_code="$body"
  if [[ "$http_code" == "201" ]]; then
    jq -r '.data | "  ✓ id=\(.id) slug=\"\(.slug)\" slots=\(.slots | length) addons=\(.addons | length) bond=$\(.bond_cents / 100)"' /tmp/vp-response.json
  elif [[ "$http_code" == "409" ]]; then
    echo "  ! slug_conflict — this package already exists on naenae (idempotent run?)"
  else
    echo "  ✗ HTTP $http_code — response body follows:"
    cat /tmp/vp-response.json
    echo
  fi
}

# ── Package 1: The clubhouse ───────────────────────────────────
post_package "The clubhouse" '{
  "name": "The clubhouse",
  "slug": "the-clubhouse",
  "sub": "Timber-lined main room · seated 80 · standing 140",
  "description": "Our main indoor space. Oak-lined ceiling, long tables, bar access. Suited to weddings, wakes, corporate days.",
  "bond_cents": 30000,
  "bond_label": "Refundable bond",
  "display_order": 10,
  "slots": [
    { "label": "Morning · 9am – 1pm", "sub": "4 hours · $720", "price_cents": 72000, "duration_hours": 4, "default_start_time": "09:00" },
    { "label": "Afternoon · 2pm – 6pm", "sub": "4 hours · $720 · Most booked", "price_cents": 72000, "duration_hours": 4, "default_start_time": "14:00" },
    { "label": "Evening · 6pm – 11pm", "sub": "5 hours · $900 · Bar staff incl.", "price_cents": 90000, "duration_hours": 5, "default_start_time": "18:00" },
    { "label": "Full day · 9am – 11pm", "sub": "14 hours · $2,340 · Save 15%", "price_cents": 234000, "duration_hours": 14, "default_start_time": "09:00" }
  ],
  "addons": [
    { "name": "Grazing platters", "description": "Locally sourced, catered by Naenae Cafe · Serves 8 per platter", "price_cents": 8500, "price_suffix": "/ platter", "countable": true, "default_quantity": 6, "default_selected": true },
    { "name": "Bowls on the green", "description": "Coach + all equipment · 90 min session · Ideal for corporate", "price_cents": 18000, "price_suffix": "/ session" },
    { "name": "Bar tab · Prepaid", "description": "Set an amount for the bar. Anything unused refunded.", "price_cents": 40000, "default_selected": true }
  ]
}'

# ── Package 2: Green + BBQ ─────────────────────────────────────
post_package "Green + BBQ" '{
  "name": "Green + BBQ",
  "slug": "green-bbq",
  "sub": "Green A plus the covered BBQ area",
  "description": "Outdoor-centric with weather cover. Great for casual summer events + kids parties.",
  "bond_cents": 15000,
  "bond_label": "Refundable bond",
  "display_order": 20,
  "slots": [
    { "label": "Weekend morning · 9am – 1pm", "sub": "4 hours · $220", "price_cents": 22000, "duration_hours": 4, "default_start_time": "09:00" },
    { "label": "Weekend afternoon · 2pm – 6pm", "sub": "4 hours · $220", "price_cents": 22000, "duration_hours": 4, "default_start_time": "14:00" },
    { "label": "Full day · 9am – 6pm", "sub": "9 hours · $400", "price_cents": 40000, "duration_hours": 9, "default_start_time": "09:00" }
  ],
  "addons": [
    { "name": "BBQ pack", "description": "Fire-up kit + gas + utensils", "price_cents": 6000, "default_selected": true },
    { "name": "Coach for the hour", "description": "A friendly intro to lawn bowls for your group", "price_cents": 9000, "price_suffix": "/ hour" }
  ]
}'

# ── Package 3: Whole shebang ───────────────────────────────────
post_package "Whole shebang" '{
  "name": "Whole shebang",
  "slug": "whole-shebang",
  "sub": "Exclusive-use all day · three greens, clubhouse, catering, host",
  "description": "The whole venue to yourselves. Best for large corporate events, charity days, big family gatherings.",
  "bond_cents": 50000,
  "bond_label": "Refundable bond",
  "display_order": 30,
  "slots": [
    { "label": "One Saturday a month", "sub": "Full day · $1,600 · Host included", "price_cents": 160000, "duration_hours": 10, "default_start_time": "09:00" }
  ],
  "addons": [
    { "name": "Full catering", "description": "Lunch + dinner + bar for up to 150", "price_cents": 280000 },
    { "name": "Photographer for the day", "description": "8 hours, final edit within 10 days", "price_cents": 95000 }
  ]
}'

# ── Verify by listing ─────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "final list — GET /clubs/$CLUB_ID/venue-packages"
curl -s -H "Authorization: Bearer $TORNY_TOKEN" \
  "$VENUE/clubs/$CLUB_ID/venue-packages" | \
  jq -r '.data | "  total: \(.counts.all)  active: \(.counts.active)  archived: \(.counts.archived)",
    (.packages[] | "  · id=\(.id)  \(.slug)  slots=\(.slot_count)  addons=\(.addon_count)  bond=$\(.bond_cents / 100)  \(if .is_active then "ACTIVE" else "ARCHIVED" end)")'

echo
echo "──────────────────────────────────────────"
echo "public read (no auth) — what the booking block sees:"
curl -s "$VENUE/public/clubs/nae-nae-bowling-club/venue-packages" | \
  jq -r '.data | "  settings: deposit \(.settings.deposit_percent)% · balance due \(.settings.balance_due_days_before) days before · active=\(.settings.is_active)",
    "  packages: \(.packages | length) visible on the public booking page",
    (.packages[] | "    · \(.name)  \(.slots | length) slots  \(.addons | length) addons")'
