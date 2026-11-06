# QuotePilot

**From a customer message to a seller-approved PayPal invoice.** QuotePilot helps independent sellers turn informal order requests into clear, catalog-priced quotes, then send the invoice through PayPal.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). The official deadline is November 12, 2026 at 12:00 p.m. Pacific Time (November 13 at 1:30 a.m. India Standard Time).

## What the demo does

1. The seller pastes a customer request and enters the customer’s email.
2. AI maps the request to the seller catalog, flags missing details, and drafts a summary.
3. The seller reviews the line items and total. Prices always come from the server-side catalog.
4. After explicit seller approval, the server creates and sends a PayPal invoice.
5. An optional verified PayPal webhook updates the quote to paid.

The AI does not set prices, invent products, or send invoices. The seller controls the final quote and payment request.

## Run locally

Requires Node.js 20 or later. There are no npm dependencies.

```powershell
Copy-Item .env.example .env
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Without credentials, QuotePilot runs in **preview mode**. The example request uses a local parser, the invoice button stays unavailable, and no real invoice is sent. This mode is clearly labeled in the UI.

## Connect AI

Add an OpenAI API key and model to `.env`:

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-6-luna
```

Restart the server. The app uses the OpenAI Responses API from the backend. The key is never sent to the browser.

## Connect PayPal sandbox

1. Create a REST app in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Copy the sandbox client ID and secret into `.env`:

```dotenv
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
PAYPAL_ENV=sandbox
PAYPAL_INVOICER_GIVEN_NAME=Maya
PAYPAL_INVOICER_SURNAME=Chen
```

3. Restart the app. Enter a sandbox buyer email in the form, generate a quote, review it, then approve and send. PayPal emails the sandbox buyer a hosted invoice payment link.

## Optional payment status webhook

PayPal must reach a public HTTPS URL for the app’s webhook route. Configure a webhook for the same REST app at:

```text
https://YOUR_PUBLIC_HOST/api/paypal/webhook
```

Subscribe to `INVOICING.INVOICE.PAID`, copy the webhook ID into `.env` as `PAYPAL_WEBHOOK_ID`, and restart. The server asks PayPal to verify each webhook signature before changing a quote’s status. The local in-memory demo state resets when the server restarts, so use a persistent database for a deployed version.

## Demo request

> I need three boxes of assorted cookies for Friday. One box should be vegan. Please keep it under $130.

The catalog resolves this to two assorted boxes ($36 each) and one vegan box ($42), for a $114 total. The seller can then review and send a PayPal invoice. Prices are computed on the server, regardless of the AI output.

## Stack

- Node.js built-in HTTP server and browser-native HTML/CSS/JavaScript
- OpenAI Responses API for request understanding
- PayPal Invoicing REST API for draft creation and email delivery
- PayPal webhook signature verification for payment status

The default AI model is `gpt-6-luna`; set `OPENAI_MODEL` to another model available to your API account if needed.

## Prototype limits

- Quotes and webhook event IDs live in memory and reset on restart.
- The starter catalog and currency are intentionally small and fixed for the hackathon demo.
- Add a database, authentication, product editing, idempotent invoice retries, and production monitoring before handling real customer data or live payments.
