#!/usr/bin/env bash
#
# Generate bespoke 1200x630 Open Graph share images for the Sprint funnel
# pages (/sprint, /proof, /fit, /book). On-brand cosmic treatment: a North
# Star sky photo darkened with a violet-tinted gradient, the white Synozur
# logo, a violet eyebrow, a bold headline, and a supporting method line.
#
# Outputs are written to artifacts/synozur/public/og/ and committed as static
# assets. Re-run this script (from anywhere) after tweaking copy or artwork.
#
# Requires ImageMagick 7 (`magick`).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$HERE/public"
OUT="$PUB/og"
FONTS="$PUB/fonts"
BOLD="$FONTS/AvenirNextLTPro-Bold.ttf"
DEMI="$FONTS/AvenirNextLTPro-Demi.ttf"
REG="$FONTS/AvenirNextLTPro-Regular.ttf"
LOGO="$PUB/images/sa-logo-horizontal-white.png"

VIOLET="#A855F7"
INK="#0B0B1A"

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Pre-scale the logo once (target ~300px wide on the card).
magick "$LOGO" -resize 300x "$TMP/logo.png"

# render <out> <sky> <eyebrow> <title> <method>
render() {
  local out="$1" sky="$2" eyebrow="$3" title="$4" method="$5"

  # 1. Base: sky cropped to fill 1200x630, darkened toward the cosmic ink so
  #    the card reads dark/dramatic rather than washed-out.
  magick "$PUB/images/$sky" -resize 1200x630^ -gravity center -extent 1200x630 \
    -modulate 62 -fill "$INK" -colorize 18 "$TMP/base.png"

  # 2. Left-to-right dark gradient for text legibility + bottom fade.
  magick -size 630x1200 gradient:'rgba(11,11,26,0.98)-rgba(11,11,26,0.55)' -rotate 90 "$TMP/gradL.png"
  magick -size 1200x630 gradient:'rgba(11,11,26,0)-rgba(11,11,26,0.85)' "$TMP/gradB.png"
  # Subtle violet nebula glow in the lower-left (over-composited, low alpha).
  magick -size 1200x630 radial-gradient:'rgba(129,15,251,0.30)-rgba(129,15,251,0)' \
    -gravity SouthWest -extent 1200x630 "$TMP/nebula.png"

  magick "$TMP/base.png" \
    "$TMP/nebula.png" -compose screen -composite \
    "$TMP/gradL.png" -compose over -composite \
    "$TMP/gradB.png" -compose over -composite \
    "$TMP/bg.png"

  # 3. Text blocks (transparent captions, left-aligned).
  magick -background none -fill "$VIOLET" -font "$DEMI" -pointsize 26 \
    -kerning 6 -gravity West -size 760x caption:"$eyebrow" "$TMP/eyebrow.png"
  magick -background none -fill white -font "$BOLD" -pointsize 66 \
    -interline-spacing 4 -gravity West -size 780x caption:"$title" "$TMP/title.png"
  magick -background none -fill '#C9C4E0' -font "$REG" -pointsize 30 \
    -gravity West -size 760x caption:"$method" "$TMP/method.png"

  # 4. Compose: logo top-left, then stacked text block down the left side.
  magick "$TMP/bg.png" \
    "$TMP/logo.png" -gravity NorthWest -geometry +72+64 -composite \
    "$TMP/eyebrow.png" -gravity West -geometry +72-96 -composite \
    "$TMP/title.png" -gravity West -geometry +70+8 -composite \
    "$TMP/method.png" -gravity West -geometry +72+150 -composite \
    -quality 88 "$out"

  echo "wrote $out"
}

render "$OUT/og-sprint.jpg" "sky-galaxy-web.jpg" \
  "THE AI & NORTH STAR SPRINT" \
  "Turn ambiguity into aligned decisions." \
  "Assess · Define · Deliver · Outcomes — in 4 to 6 weeks."

render "$OUT/og-proof.jpg" "sky-coast-web.jpg" \
  "PROOF" \
  "Outcomes we can prove." \
  "Before · After · Impact. Measurable results, not promises."

render "$OUT/og-fit.jpg" "sky-people-web.jpg" \
  "IS THE SPRINT RIGHT FOR YOU?" \
  "Where the Sprint creates the most value." \
  "For leadership teams ready to align on what matters."

render "$OUT/og-book.jpg" "sky-galaxy-web.jpg" \
  "BOOK THE CONVERSATION" \
  "Start with a focused working conversation." \
  "Understand your context and the right next step."

echo "All OG images generated in $OUT"
