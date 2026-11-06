import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const CURRENCY = (process.env.CURRENCY || 'USD').toUpperCase();
const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
const PAYPAL_BASE = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const hasPayPal = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const hasAI = Boolean(process.env.OPENAI_API_KEY);

const catalog = [
  { sku: 'classic-box', name: 'Assorted cookie box', description: '12 classic cookies', price: 36 },
  { sku: 'vegan-box', name: 'Vegan cookie box', description: '12 plant-based cookies', price: 42 },
  { sku: 'local-delivery', name: 'Local delivery', description: 'Local drop-off', price: 8 },
  { sku: 'gift-wrap', name: 'Gift wrap', description: 'Ribbon and note card', price: 4 }
];

// Hackathon prototype state. Replace with a persistent database before production use.
const quotes = new Map();
const invoiceToQuote = new Map();
const processedWebhooks = new Set();

function loadEnv(file) {
  if (!existsSync(file)) return;
  const source = requireText(file);
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function requireText(file) {
  // This helper is synchronous by design so configuration is available before the server starts.
  return readFileSync(file, 'utf8');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return { raw, json: raw ? JSON.parse(raw) : {} };
}

function money(value) {
  return Number(value).toFixed(2);
}

function quoteFromExtract(extract, originalRequest, customerEmail) {
  const requested = Array.isArray(extract.items) ? extract.items : [];
  const items = [];
  for (const entry of requested) {
    const product = catalog.find((item) => item.sku === entry.sku);
    const quantity = Math.floor(Number(entry.quantity));
    if (!product || !Number.isFinite(quantity) || quantity < 1 || quantity > 100) continue;
    items.push({
      sku: product.sku,
      name: product.name,
      description: product.description,
      quantity,
      unitPrice: product.price,
      lineTotal: product.price * quantity,
      reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 180) : ''
    });
  }
  if (!items.length) throw new Error('I could not match this request to the seller catalog. Add more detail or try the sample request.');

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const questions = Array.isArray(extract.questions)
    ? extract.questions.filter((question) => typeof question === 'string').slice(0, 4)
    : [];
  return {
    id: `Q-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    originalRequest,
    customerEmail,
    summary: typeof extract.summary === 'string' ? extract.summary.slice(0, 240) : 'Draft quote based on the seller catalog.',
    items,
    questions,
    deliveryDate: typeof extract.delivery_date === 'string' ? extract.delivery_date.slice(0, 80) : '',
    budget: extract.budget != null && Number.isFinite(Number(extract.budget)) ? Number(extract.budget) : null,
    subtotal,
    total: subtotal,
    currency: CURRENCY,
    status: 'DRAFT',
    createdAt: new Date().toISOString(),
    source: hasAI ? 'AI' : 'Preview parser',
    invoiceId: null,
    invoiceUrl: null
  };
}

function numberFromWords(value) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (value == null) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return words[String(value).toLowerCase()] ?? null;
}

function previewExtract(text) {
  const lower = text.toLowerCase();
  const countMatch = lower.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:boxes|box|dozen|dozens)\b/);
  const totalBoxes = Math.min(100, numberFromWords(countMatch?.[1]) || (lower.includes('cookie') ? 1 : 0));
  const veganMatch = lower.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:box|boxes|dozen|dozens)?\s*(?:of\s+)?vegan\b/);
  const veganQty = lower.includes('vegan') ? Math.min(totalBoxes, numberFromWords(veganMatch?.[1]) || 1) : 0;
  const classicQty = Math.max(0, totalBoxes - veganQty);
  const items = [];
  if (classicQty > 0) items.push({ sku: 'classic-box', quantity: classicQty, reason: 'Assorted boxes requested.' });
  if (veganQty > 0) items.push({ sku: 'vegan-box', quantity: veganQty, reason: 'A vegan option is requested.' });
  if (/\b(deliver|delivery|drop.?off)\b/.test(lower)) items.push({ sku: 'local-delivery', quantity: 1, reason: 'Local delivery is requested.' });
  if (/\b(gift.?wrap|gift.?wrapped|ribbon)\b/.test(lower)) items.push({ sku: 'gift-wrap', quantity: 1, reason: 'Gift wrap is requested.' });

  const budgetMatch = lower.match(/(?:under|below|budget(?: of)?|less than)\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const dateMatch = lower.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const questions = totalBoxes === 0 ? ['How many boxes would you like?'] : [];
  if (lower.includes('deliver') && !/\b(address|street|avenue|road|drive|lane|apt|suite|zip|postal)\b/.test(lower)) {
    questions.push('What delivery address should the seller use?');
  }
  return {
    items,
    questions,
    delivery_date: dateMatch?.[1] || null,
    budget: budgetMatch ? Number(budgetMatch[1]) : null,
    summary: totalBoxes
      ? `${totalBoxes} box${totalBoxes === 1 ? '' : 'es'} requested${veganQty ? `, including ${veganQty} vegan` : ''}${dateMatch ? ` for ${dateMatch[1]}` : ''}.`
      : 'I need a little more detail before I can make a quote.'
  };
}

async function extractWithAI(requestText) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-6-luna',
      max_output_tokens: 700,
      instructions: [
        'You turn a customer message into a draft quote for a small cookie shop.',
        'Only select SKUs present in the catalog. Do not invent products, prices, quantities, tax, stock, or delivery details.',
        'Use item quantity as a whole number. When details needed to fulfill an order are absent, put concise questions in questions.',
        'One vegan box replaces one assorted box when the customer says some of the requested boxes should be vegan.',
        'Respond with a single valid JSON object and no markdown. Keys: summary (string), items (array of {sku,quantity,reason}), questions (array of strings), delivery_date (string or null), budget (number or null).'
      ].join(' '),
      input: JSON.stringify({
        customer_request: requestText,
        catalog: catalog.map(({ sku, name, description, price }) => ({ sku, name, description, price, currency: CURRENCY }))
      })
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || 'The AI service could not create a quote.';
    throw new Error(message);
  }
  const outputText = (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text' || part.type === 'text')
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  if (!outputText) throw new Error('The AI service returned an empty quote. Please try again.');
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    const json = outputText.match(/\{[\s\S]*\}/);
    if (!json) throw new Error('The AI could not format this quote. Please try again.');
    parsed = JSON.parse(json[0]);
  }
  return parsed;
}

async function paypalToken() {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Could not authenticate with PayPal. Check your sandbox credentials.');
  return data.access_token;
}

async function paypalRequest(token, url, body) {
  const response = await fetch(`${PAYPAL_BASE}${url}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.details?.map((detail) => detail.description).filter(Boolean).join(' ');
    throw new Error(details || data.message || 'PayPal could not process the invoice.');
  }
  return data;
}

async function createAndSendInvoice(quote, customerEmail) {
  const token = await paypalToken();
  const invoice = await paypalRequest(token, '/v2/invoicing/invoices', {
    detail: {
      currency_code: quote.currency,
      note: 'Quote prepared with QuotePilot. Thank you for your order.'
    },
    invoicer: {
      name: {
        given_name: process.env.PAYPAL_INVOICER_GIVEN_NAME || 'QuotePilot',
        surname: process.env.PAYPAL_INVOICER_SURNAME || 'Seller'
      }
    },
    primary_recipients: [{ billing_info: { email_address: customerEmail } }],
    items: quote.items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: String(item.quantity),
      unit_amount: { currency_code: quote.currency, value: money(item.unitPrice) }
    }))
  });
  await paypalRequest(token, `/v2/invoicing/invoices/${encodeURIComponent(invoice.id)}/send`, {
    send_to_recipient: true,
    send_to_invoicer: true
  });
  return invoice;
}

async function verifyWebhook(req, event) {
  if (!process.env.PAYPAL_WEBHOOK_ID) throw new Error('Set PAYPAL_WEBHOOK_ID before enabling live webhook verification.');
  const token = await paypalToken();
  const result = await paypalRequest(token, '/v1/notifications/verify-webhook-signature', {
    transmission_id: req.headers['paypal-transmission-id'],
    transmission_time: req.headers['paypal-transmission-time'],
    cert_url: req.headers['paypal-cert-url'],
    auth_algo: req.headers['paypal-auth-algo'],
    transmission_sig: req.headers['paypal-transmission-sig'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event
  });
  return result.verification_status === 'SUCCESS';
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, {
      aiConfigured: hasAI,
      paypalConfigured: hasPayPal,
      paypalEnvironment: PAYPAL_ENV,
      currency: CURRENCY,
      catalog,
      sampleRequest: 'I need three boxes of assorted cookies for Friday. One box should be vegan. Please keep it under $130.'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/quotes') {
    let body;
    try { body = (await readBody(req)).json; } catch { return sendJson(res, 400, { error: 'Please send a valid request.' }); }
    const requestText = typeof body.request === 'string' ? body.request.trim() : '';
    const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : '';
    if (requestText.length < 8 || requestText.length > 2000) return sendJson(res, 400, { error: 'Describe the order in 8–2,000 characters.' });
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return sendJson(res, 400, { error: 'Enter a valid customer email address.' });
    try {
      const extract = hasAI ? await extractWithAI(requestText) : previewExtract(requestText);
      const quote = quoteFromExtract(extract, requestText, customerEmail);
      if (quote.budget != null && quote.total > quote.budget) quote.questions.unshift(`This quote is ${money(quote.total - quote.budget)} over the stated budget. Would you like to adjust the order?`);
      quotes.set(quote.id, quote);
      return sendJson(res, 200, { quote, aiConfigured: hasAI });
    } catch (error) {
      return sendJson(res, 502, { error: error.message || 'Could not create a quote.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/invoices') {
    let body;
    try { body = (await readBody(req)).json; } catch { return sendJson(res, 400, { error: 'Please send a valid request.' }); }
    const quote = quotes.get(body.quoteId);
    const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : quote?.customerEmail;
    if (!quote) return sendJson(res, 404, { error: 'Quote expired. Create it again before invoicing.' });
    if (quote.questions.length) return sendJson(res, 409, { error: 'Resolve the quote questions before sending an invoice.' });
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) return sendJson(res, 400, { error: 'Add a valid customer email before sending the invoice.' });
    quote.customerEmail = customerEmail;
    if (!hasPayPal) return sendJson(res, 503, { error: 'PayPal sandbox is not connected yet. Add your credentials to .env and restart the app.' });
    try {
      const invoice = await createAndSendInvoice(quote, customerEmail);
      quote.invoiceId = invoice.id;
      quote.status = 'SENT';
      invoiceToQuote.set(invoice.id, quote.id);
      return sendJson(res, 200, { quote, invoiceId: invoice.id, status: 'SENT' });
    } catch (error) {
      return sendJson(res, 502, { error: error.message || 'Could not send the PayPal invoice.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/quotes') {
    return sendJson(res, 200, { quotes: [...quotes.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }

  if (req.method === 'POST' && url.pathname === '/api/paypal/webhook') {
    let raw, event;
    try { ({ raw, json: event } = await readBody(req)); } catch { return sendJson(res, 400, { error: 'Invalid webhook payload.' }); }
    if (!hasPayPal || !process.env.PAYPAL_WEBHOOK_ID) return sendJson(res, 503, { error: 'Webhook verification is not configured.' });
    try {
      if (!(await verifyWebhook(req, event))) return sendJson(res, 400, { error: 'Webhook signature could not be verified.' });
      if (processedWebhooks.has(event.id)) return sendJson(res, 200, { received: true, duplicate: true });
      processedWebhooks.add(event.id);
      if (event.event_type === 'INVOICING.INVOICE.PAID') {
        const quoteId = invoiceToQuote.get(event.resource?.id);
        const quote = quotes.get(quoteId);
        if (quote) quote.status = 'PAID';
      }
      return sendJson(res, 200, { received: true });
    } catch (error) {
      console.error('Webhook verification failed:', error.message);
      return sendJson(res, 502, { error: 'Webhook verification failed.' });
    }
  }

  return sendJson(res, 404, { error: 'API route not found.' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(PUBLIC, relative);
  if (!filePath.startsWith(`${PUBLIC}${path.sep}`) && filePath !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QuotePilot is running at http://localhost:${PORT}`);
  console.log(`AI: ${hasAI ? 'connected' : 'preview mode'} · PayPal: ${hasPayPal ? PAYPAL_ENV : 'not connected'}`);
});
