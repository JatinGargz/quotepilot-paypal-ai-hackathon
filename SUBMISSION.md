# Hackathon submission draft

Official event: [PayPal AI Hackathon on Devpost](https://paypalaihackathon.devpost.com/)

**Deadline:** November 12, 2026 at 12:00 p.m. Pacific Time (November 13 at 1:30 a.m. India Standard Time).

## Project name

QuotePilot

## One-line pitch

QuotePilot turns a customer’s informal order message into a seller-approved, catalog-priced quote and a PayPal invoice.

## Problem

Independent sellers often receive orders through DMs, email, and text. Re-entering the request, calculating a quote, asking for missing details, and following up for payment takes time away from making and delivering the product.

## Solution

The seller pastes a customer request into QuotePilot. AI extracts the requested items and quantities from a known catalog, summarizes the order, and flags missing information. The seller reviews the quote and explicitly approves it. QuotePilot then creates and emails a PayPal invoice. A verified PayPal webhook can update the order when payment arrives.

## Why AI matters

AI interprets free-form customer language, maps it to catalog items, and catches ambiguity before it becomes an invoice. It cannot set prices or invent products. Prices and totals are calculated on the server from the seller’s catalog.

## Why PayPal matters

PayPal is the payment and invoicing layer: the approved quote becomes a real sandbox invoice that the customer can pay through PayPal. PayPal events can then return payment status to QuotePilot.

## Demo script

1. Paste: “I need three boxes of assorted cookies for Friday. One box should be vegan. Please keep it under $130.”
2. Show AI extracting two assorted boxes and one vegan box, with the budget and delivery timing in the summary.
3. Review the catalog prices and $114 total; point out that the seller remains in control.
4. Enter a PayPal sandbox buyer email and approve the invoice.
5. Show the sent invoice in PayPal sandbox. If the verified webhook is connected, show QuotePilot update the order to paid after checkout.

## Built with

Node.js, Gemini API (`gemini-3.5-flash-lite` free tier), PayPal Invoicing REST API, verified PayPal invoice webhooks, HTML, CSS, and browser JavaScript. The AI maps natural-language orders to approved catalog SKUs; server-side code calculates prices and totals.

## Team / links

- Team: [add team members]
- Demo URL: [add deployed URL]
- Video: [add demo recording]
- Repository: https://github.com/JatinGargz/quotepilot-paypal-ai-hackathon

## Submission checklist

- [ ] Join the hackathon on Devpost and confirm entrant eligibility.
- [ ] Add team members (or confirm solo entry).
- [x] Push this source to a public GitHub repository. The MIT `LICENSE` file is at the repository root.
- [ ] Configure AI and PayPal sandbox credentials and capture a working end-to-end demo.
- [ ] Record and upload a public YouTube demo video under three minutes.
- [ ] Add the public repository URL, demo URL or complete setup instructions, tools description, and YouTube link to the Devpost project form.
- [ ] Submit before the deadline above.
