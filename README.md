# myHome

## Deploy

### 1. Create provider credentials

1. In Google AI Studio, create an API key if you want Gemini.
2. In the OpenAI platform, create an API key if you want OpenAI.
3. In EmailJS, connect an email service and create one template. Set the template's **To Email** to `{{to_email}}`, its subject to `{{subject}}`, and include the variables `{{notification_type}}`, `{{requester_email}}`, `{{property_title}}`, `{{property_location}}`, `{{rejection_reason}}`, `{{search_criteria}}`, `{{viewing_date}}`, `{{viewing_time}}`, and `{{message}}` in its body. Copy the service ID, template ID, public key, and private key from your EmailJS account.

### 2. Add secrets in Supabase

1. Open the project in the Supabase Dashboard.
2. Open **Project Settings → Edge Functions → Secrets** (or **Edge Functions → Secrets**, depending on the Dashboard layout).
3. Add these names and values. Paste each real value into the Supabase secret-value field; do not put values in this repository or in the browser.

| Secret name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key (optional) |
| `OPENAI_API_KEY` | OpenAI API key (optional) |
| `EMAILJS_PUBLIC_KEY` | EmailJS public key |
| `EMAILJS_PRIVATE_KEY` | EmailJS private key |
| `EMAILJS_SERVICE_ID` | EmailJS email-service ID |
| `EMAILJS_TEMPLATE_ID` | EmailJS template ID |
| `AGENCY_EMAIL` | Agency inbox for new listings and contact requests |
| `APP_ORIGINS` | Comma-separated exact website origins, e.g. `https://example.com,https://www.example.com`; optional previews may use `https://*.vercel.app` or `https://*.netlify.app` |

Supabase automatically provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions. Do not copy the service-role key into the website.

The CLI alternative is `supabase secrets set --project-ref YOUR_PROJECT_REF NAME=value ...`; enter real values only in your own trusted terminal, not in chat, commits, or screenshots. You can list configured secret names (not values) with `supabase secrets list --project-ref YOUR_PROJECT_REF`.

### 3. Apply the database changes

Install the Supabase CLI, then run these commands from this repository:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

`db push` applies the migrations for listing approvals, storage, privacy-consent records, rate limits, and email idempotency.

### 4. Deploy the Edge Functions

Run each command from this repository:

```sh
supabase functions deploy ai --project-ref YOUR_PROJECT_REF --no-verify-jwt
supabase functions deploy send-email --project-ref YOUR_PROJECT_REF --no-verify-jwt
supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

JWT verification is performed inside the email and account-deletion functions; the AI function also checks valid user identity where available and rate-limits anonymous requests by IP. The `--no-verify-jwt` option is needed for publishable-key browser calls and does **not** make the email or deletion actions anonymous.

Current limits are 8 AI requests per minute and 50 per hour, 8 email requests per minute and 40 per hour, and 3 account-deletion attempts per hour. Limits are per signed-in user, or per IP for anonymous requests.

### 5. Publish the static website

- **Vercel:** import this Git repository, select **Other** as the framework preset, leave the build command empty, and set the output directory to `.`.
- **Netlify:** import this Git repository, leave the build command empty, and set the publish directory to `.`.
- Keep `data/supabase-config.js` limited to the Supabase URL and publishable key. These are intended for public browser use; never put service-role, EmailJS, OpenAI, or Gemini keys there.
- Set `APP_ORIGINS` to the final deployed origin(s), save the secret, and redeploy the functions if needed. The browser needs the exact origin to call the functions.
- Replace `privacy.html`'s placeholder contact and policy text with a policy reviewed for your organization and jurisdictions before accepting real users.

The existing page uses Tailwind's CDN and has extensive inline HTML styling. Replacing it with a compiled Tailwind build would require introducing a build pipeline and verifying every generated class; that is a meaningful regression risk for this static app, so the CDN is intentionally left in place for now.

## Security checklist

- [ ] Apply all Supabase migrations and deploy all three functions.
- [ ] Add provider and EmailJS credentials only to Supabase Edge Function Secrets.
- [ ] Set `APP_ORIGINS` to only the production website origins and any necessary preview origins.
- [ ] In EmailJS, restrict allowed origins/domains to your website and verify the template's recipient is `{{to_email}}`.
- [ ] Never expose the Supabase service-role key or provider keys to the browser. The Supabase publishable key is expected to be public.
- [ ] Revoke and replace any provider key that was previously pasted into the old browser AI form or otherwise exposed.
- [ ] Test signup consent, listing consent, admin approval/rejection emails, AI rate limits, and account deletion before launch.
- [ ] Replace the privacy-policy placeholder and identify the responsible legal entity and contact.
- [ ] Check Supabase Auth email-confirmation, password, redirect-URL, and abuse-protection settings.
- [ ] Review function logs and email-provider usage for unexpected requests.
