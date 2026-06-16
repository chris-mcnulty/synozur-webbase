---
name: Email style standards
description: Font family and header image to use for all Synozur transactional emails
---

## Rule
All outgoing Synozur emails must use **Avenir Next LT Pro** as the primary font, with a safe fallback chain for email clients that don't have it installed. The standard header banner is the short purple-to-pink gradient image with the Synozur Alliance logo.

**Why:** Confirmed by user — "Preferred font will always be Avenir Next LT Pro and this is our standard header image."

## How to apply

### Font stack (inline style on `<body>` and any explicit font-family declarations)
```
'Avenir Next LT Pro','Avenir Next','Avenir',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif
```

### Header image
- Source file: `attached_assets/SA_EmailHeader_short_*.jpg` (the short/landscape JPG, not the tall PNG)
- Served from: `artifacts/synozur/public/email-header.jpg`
- Referenced in emails via: `${EMAIL_ORIGIN}/email-header.jpg`
- Dimensions: 1600×337px JPEG
- The tall PNG (`SA_EmailHeader_v333_*.png`) is the full-bleed version — use it for web/print, not email headers.

### Shell structure (briefing podcast email, and new emails going forward)
- Outer bg: `#f4f4f6`
- Card: white, `max-width:600px`, `border-radius:10px`, `box-shadow:0 2px 12px rgba(0,0,0,0.10)`
- Header: full-width `email-header.jpg` image
- Body padding: `36px 40px 28px`
- Footer bg: `#f9f9fb`, border-top `#eaeaf0`, centered, 12px text, `#888899`
- Brand primary: `#810FFB`
