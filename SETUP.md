# Cloudflare setup — step by step

You can get the portal working first and enable email later. You do not need to share your passwords or Resend API key in chat.

## 1. Put the files in a new GitHub repository

1. Create a repository, for example `shivani-production`.
2. Extract this ZIP.
3. Upload the **contents** of the `shivani-production` folder to the repository root. You should see `public`, `functions`, `server`, `worker`, and `schema.sql` at the top level.
4. Keep the existing customer-facing CPP repository as its own project.

## 2. Create the database

1. In Cloudflare, open **D1** and create a database named `shivani-production`.
2. Open its SQL console.
3. Paste and execute the contents of `schema.sql`. If the console requires separate submissions, run the statements individually in their existing order.
4. Copy the database ID for the email Worker configuration later.

This schema creates new portal tables. Use the new database, not the CPP database.

## 3. Create the file bucket

1. Open **R2** and create a bucket named `shivani-production-files`.
2. Leave public access disabled.

One private R2 bucket contains separate folders for each project and file category. The portal displays three separate upload areas. You do not need R2 access keys or a public bucket URL; the application uses a Cloudflare binding.

## 4. Create the Pages project

Connect the new GitHub repository to a **Cloudflare Pages** project.

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `exit 0` |
| Build output directory | `public` |
| Root directory | Leave blank, if the files are at repository root |
| Node version variable, if needed | `NODE_VERSION` = `24` |

The API is deployed from the repository's `functions` folder. Use Git integration; uploading just `public/` through a static-file drag-and-drop flow would omit the API.

## 5. Add the Pages bindings and variables

Open the Pages project's **Settings → Bindings** and add:

| Type | Variable name | Resource |
| --- | --- | --- |
| D1 database | `DB` | `shivani-production` |
| R2 bucket | `UPLOADS` | `shivani-production-files` |

In **Variables and Secrets**, add:

| Name | Type | Value |
| --- | --- | --- |
| `PORTAL_URL` | Text | Your final HTTPS portal URL, with no trailing slash |
| `BOOTSTRAP_USERS_JSON` | Secret | The four-account JSON below, with your own passwords |

Example structure — **replace every password placeholder before saving**. You can change the usernames and RFG display names too.

```json
[
  {"username":"saunak","display_name":"Saunak Shah","role":"admin","password":"REPLACE_WITH_SAUNAK_PASSWORD"},
  {"username":"atit","display_name":"Atit","role":"admin","password":"REPLACE_WITH_ATIT_PASSWORD"},
  {"username":"rfg1","display_name":"RFG User 1","role":"vendor","password":"REPLACE_WITH_RFG1_PASSWORD"},
  {"username":"rfg2","display_name":"RFG User 2","role":"vendor","password":"REPLACE_WITH_RFG2_PASSWORD"}
]
```

Use different passwords of at least 12 characters. Usernames can contain letters, numbers, periods, underscores, and dashes.

**Redeploy Pages after adding these settings.** Cloudflare documents the binding setup and redeployment requirement in its [Pages bindings guide](https://developers.cloudflare.com/pages/functions/bindings/).

On the first sign-in attempt, the portal creates all four accounts and stores salted password hashes in D1. Once the accounts exist, you can remove `BOOTSTRAP_USERS_JSON` and redeploy. Editing that secret later does not reset existing accounts. Users can change their password through My account.

The site is now usable. Email events are queued even if the email Worker is not set up yet. RFG can upload, comment, update stages, and add cost/invoice details; it cannot edit order specifications.

## 6. Configure the notification Worker

This small second Cloudflare service checks queued emails every minute and sends the daily digest. It uses the **same D1 database and R2 bucket** as Pages.

Open `worker/wrangler.jsonc` and replace:

| Placeholder | What goes there |
| --- | --- |
| `REPLACE_WITH_D1_DATABASE_ID` | The database ID from step 2 |
| `https://REPLACE_WITH_YOUR_PROJECT.pages.dev` | The same HTTPS URL used for Pages `PORTAL_URL` |

If you chose different database or bucket names, update those names in the same file. Leave `NOTIFICATIONS_ENABLED` as `"false"` while setting up.

### Deploy the Worker

From a terminal in the extracted project folder, with Node.js installed:

```sh
npx wrangler login
npx wrangler deploy --config worker/wrangler.jsonc
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.jsonc
```

The last command prompts for your Resend key; paste it there. You can also add `RESEND_API_KEY` as a secret in the deployed Worker's Cloudflare settings. The key belongs on the **notification Worker**, not in browser code or GitHub.

The configuration supplies the cron expression `* * * * *`. Confirm the Worker has this scheduled trigger. Cron runs in UTC; the code converts to `America/New_York` and handles daylight saving time. See [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

If using Cloudflare's Git-connected Worker deployment instead of a terminal, use the repository root as the root directory and `npx wrangler deploy --config worker/wrangler.jsonc` as the deploy command. Add the secret to that Worker after its first deployment.

## 7. Finish Resend whenever you are ready

Your template IDs are already wired into the code:

| Template | ID |
| --- | --- |
| production-new-project | `4f4db824-1700-4714-84f9-8e7687275b33` |
| production-stage-change | `f8b858e4-e522-4f48-a30c-fe43e759148a` |
| production-comment | `71a5bf03-fbb2-4469-9cb0-a0de1ce2171f` |
| production-delivery-digest | `529de6db-4731-4c91-9770-aef21fd4ef14` |

1. Confirm the sending domain has finished verification in Resend.
2. Confirm all four templates are **published**, not just saved as drafts. Resend only sends published templates. [Resend send-email reference](https://resend.com/docs/api-reference/emails/send-email)
3. Keep these exact variable names in each template:

| Template | Variables |
| --- | --- |
| New project | `CREATED_BY`, `PROJECT_NAME`, `CAD_FILE_NAME`, `METAL`, `QUANTITY`, `DELIVERY_DATE`, `PROJECT_URL` |
| Stage change | `PROJECT_NAME`, `PREVIOUS_STAGE`, `NEW_STAGE`, `UPDATED_BY`, `UPDATED_AT`, `DELIVERY_DATE`, `PICKUP_DETAILS`, `PROJECT_URL` |
| Comment | `COMMENT_AUTHOR`, `PROJECT_NAME`, `COMMENT_DATE`, `CURRENT_STAGE`, `DELIVERY_DATE`, `COMMENT_TEXT`, `PROJECT_URL` |
| Delivery digest | `DIGEST_DATE`, `DUE_SOON_PROJECTS`, `OVERDUE_PROJECTS`, `PORTAL_URL` |

4. Set `NOTIFICATIONS_ENABLED` to `"true"` in `worker/wrangler.jsonc`, then deploy the Worker again.
5. Open the portal's **Email activity** page to see the worker check-in and pending/sent/failed emails.

Turning sending on also releases emails queued while it was off. Leave it off if you are entering practice projects. The included development server never sends emails.

Resend sends as **Shivani Production <saunak@shivanigems.com>** with replies to `saunak@shivanigems.com`. No Gmail or Outlook mailbox connection is needed. Email replies go to Saunak's inbox; they are not automatically added as portal comments.

### Recipient rules

“Everyone” means Saunak, Atit, and `rfgworkshopny@gmail.com`.

| Event / destination stage | Recipients |
| --- | --- |
| Project Created | Everyone |
| Project Accepted by RFG | Saunak + Atit |
| Stones Sent to RFG | RFG |
| Stones Received by RFG | Saunak + Atit |
| Casting | Saunak + Atit |
| Setting | Saunak + Atit |
| Project Ready for Pickup | Saunak + Atit |
| Received by Shivani | Everyone |
| Comment by RFG | Saunak + Atit |
| Comment by Shivani | RFG |
| Weekday delivery digest | Everyone |

The digest runs during the 9 AM New York hour, once per recipient per weekday. It includes due-today / next-two-calendar-day projects and overdue projects. Completed projects and projects without a date are excluded. Empty digests are not sent. Long comments/lists are shortened in email, with links to the full portal details.

### Free-plan limits

The portal's sender stops at 90 sent recipients per UTC day to leave headroom under Resend's listed 100/day free limit. Other applications sharing the Resend account also consume its allowance; provider rate limits are handled through the queue. Check your account's monthly allowance before enabling. [Resend pricing](https://resend.com/pricing)

Large CAD files consume R2 storage. R2 has a free allowance, but storage and operations beyond it are billed; this is not an unlimited-free-storage guarantee. [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)

## Useful troubleshooting

| What you see | What to check |
| --- | --- |
| “Add the DB D1 binding” | Pages binding named exactly `DB`, followed by redeployment |
| “Run schema.sql” | Initialize the new D1 database with the included SQL |
| “Add BOOTSTRAP_USERS_JSON” | Add the four-account JSON as a Pages secret, then redeploy |
| Files won't upload | R2 binding named exactly `UPLOADS`; correct file category; no file above 100 MiB |
| “Worker is not connected yet” | Deploy the separate notification Worker and verify its cron trigger and D1 binding |
| Emails remain queued | Worker enabled, Resend key present, domain verified, templates published |
| Failed notification | Read the error under Email activity; fix the cause, then Retry |
| Delivery response uncertain / retry window expired | Check Resend logs before Retry to avoid a duplicate email |
| Edit conflict | Another user changed the project; reload before submitting again |

Use separate D1/R2 resources for preview deployments if you connect preview branches. Production email settings and secrets should stay in the production environment.
