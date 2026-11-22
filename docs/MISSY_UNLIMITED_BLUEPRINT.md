# Missy Unlimited — Product blueprint (working draft)
Date: November 22, 2026
Product: Missy by SiteStyles
Development branch: feature/missy-unlimited-foundation

## Non-negotiable
Extend Missy Central v0.3, do **not** overwrite or redesign the approved private Mac edition. Retain the current user's local data in `~/Library/Application Support/missy-central/data`. Keep an export path, version migrations, and a rollback plan. No public customer access to the existing localhost server or the owner's records. AI can assist, but everyday tasks, math, budgets, lists, calendar, and checklists work without AI. Never claim an external action succeeded unless a real integration confirms it.

## Product hierarchy
One recognizable Missy, with an optional desktop experience, adult mobile app, and age-appropriate family access:
- **Missy Unlimited (adult):** My Day, Household, My Headquarters, Creator, Money Pots, Messages, Talk to Missy. Modes are contexts/permissions, not separate bots.
- **Missy Kids:** Simplified child-approved activities, reading, chores, reminders, approved family messaging, permissions.
- **Missy Teens:** Mature but age-appropriate styling, own activity calendar, homework, goals, spending requests, "Ask Mom / Ask Guardian", privacy controls and permissions; no childish cartoon UI.
- **Missy Central (owner):** Preserve private operations dashboard with the original approved design and Miss Claudie where applicable.
All screens are views on intentionally scoped records, not copies of a private local database. Parent and co-parent roles see only explicitly shared information.

## Core navigation
Desktop: configurable Morning Scan, My Day, Household, Headquarters, Creator, Money Pots, Messages, Stickies, Talk to Missy. Keep scan widgets actionable and grounded in verified records.
Phone: My Day scan and three highlights first; bottom navigation for main areas; Talk to Missy visible; installable home-screen widgets where supported.
Kids/teens: child-specific navigation and authorized alerts. Family calendar items shared selectively, never the parent's private finances or messages.

## Morning, Night and Kids scans
- Morning Scan: upcoming events, priority tasks, confirmed arrival/check-ins, commitments and available relevant money-pot figures. Use *unknown/not connected* when a source isn't available.
- Night Scan: read each outstanding item, ask "done, tomorrow, or skip?", and save actual statuses only after the person's confirmation.
- Kids Scan: homework, schedule, chores and authorized location check-ins; no invented tracking or unverified school arrival.
- Creator Scan: authorized platform data for content, brand work, invoices and affiliate earnings; never fabricate figures.
- Business Scan: per-business tasks, orders and connected data, strictly scoped.
- Demo scans MUST have prominent "Sample data — demonstration" labels.

## Universal features and integrations
- Stickies (first build increment): local notes, pinned/unpinned, status, color, optional general/home/business/creator scope, manual/voice entry; existing version must not require AI.
- Schedule Up and other SiteStyles software retain standalone products and integrate through versioned, permission-scoped adapters.
- Messaging is reusable infrastructure across Missy and SiteStyles; proper identity, tenant isolation, retention and blocking before public release.
- PrepReady, Ecom Radar, Post Roulette, Punch In, Waveryx: capabilities only when integrations and entitlements actually exist.
- Private Vault/Legacy Access is a **standalone security-sensitive product** requiring separate design, client-side encryption, key recovery, independent audits and legal review; no automatic AI access.

## Security and trust gates for a public product
The present Chrome edition is a **single-user local app** on 127.0.0.1:4747. It is NOT an authenticated, internet-facing multi-user service. Before selling shared accounts, build a separate production backend with authenticated identity, per-person/per-household and per-organization authorization, encryption in transit and at rest, auditable role changes, backups and recovery, billing controls, key management, explicit consent, child privacy compliance review and a security assessment. No stealth recording or monitoring. Child safe-word or background Guardian detection is exploratory, dependent on supported device APIs, legal review and fail-safe transparency; never advertise as guaranteed emergency protection.

## Visual direction
Preserve Missy's red/champagne/black/gold brand but move away from "Christmas": remove ornamental florals/holiday sparkles, seasonal ribbons, gilded flourishes and ornate serifs everywhere. Use a sophisticated modern product interface with warm champagne, controlled red accents, strong contrast, subtle depth and spacious cards.
Adults: premium, professional and warm.
Kids: playful and clear without patronizing.
Teens: modern, self-directed, non-childish, privacy-aware.

## Distribution and monetization (unfinalized)
- Standalone Missy subscription or membership, desktop and phone tied to the same account.
- Add Missy as an optional SiteStyles Headquarters Toolbox component; not required to operate any business tool.
- Household family seats with limited child accounts; guest invited co-parent and trusted contact roles should have basic access at no additional per-person fee if sustainable.
- Separate optional features or higher tiers can cover higher-cost AI and large storage; publish clear usage limits, not a false promise of infinite model access.
- Keep basic privacy/security standard for all customers; never charge extra for baseline encryption.
- Price only after calculating hosting, AI, messaging, storage, support and app marketplace costs. Mockup prices are not approved commercial prices.

## Roadmap — build incrementally, launch intentionally
1. **Preserve v0.3 & extend:** branch, add offline Stickies to Mac/Chrome UI, regression tests, documented migrations. Existing approved design stays.
2. **Shared core contracts:** define person, household, organization, role, business tool integration, notes, tasks and scans; data scoping and approval gates. Design migrations before moving private data.
3. **Desktop experience:** adaptive scan dashboard with real data and approval-based nightly closeout.
4. **Accounts & secure synchronization:** build and audit a secure service before mobile multi-user access. Never reuse the localhost server as a public API.
5. **Mobile adult + Kids + Teens:** native/web views with age-appropriate role controls, real notifications and supported widgets.
6. **Paid integrations:** connect SiteStyles tools, business systems and third-party providers one-by-one. Mark disconnected sources honestly.
7. **Release readiness:** run security/privacy accessibility reviews, child-related legal review, cross-device tests and pricing analysis. Do not publish or promise production features before verification.

## Current branch status
First functional increment: Stickies code and UI were added to the development branch, along with a regression test. This is **not production-deployed** and **not yet run/tested against the user's live Mac installation**. Complete automated and manual validation before merging.
