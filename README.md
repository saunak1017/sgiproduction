# Shivani Production Portal

A private production workspace for Shivani Gems and RFG Workshop, built for **Cloudflare Pages + D1 + R2**, with a separate scheduled Worker for Resend notifications.

Start with **SETUP.md**. This is a separate project from the customer-facing CPP; use a new repository and database.

## Included

- Two admin logins and two RFG logins, configured privately during setup.
- All requested order fields are optional, with repeatable stone rows and automatic per-stone/total-weight calculations.
- Active and completed project cards, stage colors, progress trackers, filters, and search.
- All eight production stages, including backward moves and skipped stages.
- Optional cost, per-piece/total-order choice, and invoice prompt at Ready for Pickup.
- Project comments and stage history.
- Separate reference-image, STL, and 3DM upload areas. Multiple files; up to 100 MiB per file, uploaded in 8 MiB chunks. Files remain private.
- Your four Resend template IDs and agreed recipient routing.
- Weekday delivery digest at 9 AM New York time, covering overdue projects and those due within two calendar days.
- Durable email queue, retry handling, and an admin Email activity page.
- Local form inputs: no requests or whole-form redraws while typing. Password hashing uses exactly **100,000 PBKDF2 iterations**.

## Permissions

| Action | Saunak / Atit | RFG users |
| --- | --- | --- |
| Create projects / edit order specifications | Yes | No |
| View projects and download files | Yes | Yes |
| Move stages forward or backward | Yes | Yes |
| Upload files / post comments | Yes | Yes |
| Enter cost and invoice details | Yes | Yes |
| View notification delivery activity | Yes | No |

Each user can change their own password under My account. The two RFG logins share the notification address `rfgworkshopny@gmail.com`.

## Source layout

| Location | Purpose |
| --- | --- |
| `public/` | Browser interface, styles, shared calculations |
| `functions/api/[[path]].js` | Cloudflare Pages API entry point |
| `server/` | Authentication, permissions, orders, uploads, email queue |
| `schema.sql` | D1 database initialization |
| `worker/` | Scheduled email delivery and reminders |
| `tests/` | Backend and isolated form tests |
| `scripts/` | Local development and source checks |

## Local development (optional)

With Node.js 24 installed:

```sh
npm ci
npm run dev
```

The development server prints temporary **local-only** login details and disables email sending. Local data stays under `.local/`, excluded from Git and this delivery package.

```sh
npm test
npm run check
```

See **VALIDATION.md** for checks completed and the remaining limitations. The final verification pass was skipped at your request. This package has not been deployed to your Cloudflare account, and no live emails were sent.
