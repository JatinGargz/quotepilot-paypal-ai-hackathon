const $ = (selector) => document.querySelector(selector);
const state = { config: null, quote: null, busy: false };

const form = $('#quote-form');
const requestInput = $('#request-text');
const emailInput = $('#customer-email');
const quoteContent = $('#quote-content');
const quoteEmpty = $('#quote-empty');
const statusBadge = $('#quote-status');
const sendButton = $('#send-invoice');
const messageBox = $('#form-message');
const toast = $('#toast');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatMoney(value, currency = state.config?.currency || 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value) || 0);
}

function setMessage(text = '', type = '') {
  messageBox.textContent = text;
  messageBox.className = `form-message ${type}`;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3600);
}

function updateConnection() {
  const pill = $('#connection-pill');
  if (!state.config) return;
  const connected = state.config.aiConfigured && state.config.paypalConfigured;
  pill.className = `connection-pill ${connected ? 'ready' : 'preview'}`;
  pill.lastElementChild.textContent = connected ? 'AI + PayPal connected' : 'Preview mode';
  const status = state.config.paypalConfigured ? state.config.paypalEnvironment === 'sandbox' ? 'PayPal sandbox ready' : 'PayPal connected' : 'PayPal not connected';
  $('#invoice-note').textContent = state.config.paypalConfigured
    ? 'Seller approval is required before PayPal emails the invoice.'
    : `${status}. Add sandbox credentials in .env to send a real invoice.`;
  updateInvoiceButton();
}

function updateInvoiceButton() {
  const quote = state.quote;
  const needsAttention = quote?.questions?.length > 0;
  const canSend = Boolean(quote && state.config?.paypalConfigured && !needsAttention && !state.busy && quote.status !== 'SENT' && quote.status !== 'PAID');
  sendButton.disabled = !canSend;
  if (quote?.status === 'PAID') $('#invoice-button-text').textContent = 'Payment received';
  else if (quote?.status === 'SENT') $('#invoice-button-text').textContent = 'Invoice sent';
  else $('#invoice-button-text').textContent = state.config?.paypalConfigured ? 'Approve & send invoice' : 'PayPal setup needed';
}

function drawQuote(quote, aiConfigured) {
  const isNewQuote = state.quote?.id !== quote.id;
  state.quote = quote;
  quoteEmpty.classList.add('hidden');
  quoteContent.classList.remove('hidden');
  const name = quote.customerEmail ? quote.customerEmail.split('@')[0].replace(/[._-]/g, ' ') : 'New customer';
  const prettyName = name.split(' ').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || 'New customer';
  const initials = prettyName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  $('#customer-name').textContent = prettyName;
  $('#customer-email-display').textContent = quote.customerEmail || 'Add an email before you invoice';
  $('#customer-avatar').textContent = initials;
  $('#order-date').textContent = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date()).toUpperCase();
  $('#quote-summary').textContent = quote.summary;
  $('#source-chip').textContent = aiConfigured ? 'AI DRAFT' : 'PREVIEW PARSER';
  $('#quote-total').textContent = formatMoney(quote.total, quote.currency);
  $('#quote-items').innerHTML = quote.items.map((item) => `
    <div class="quote-line">
      <div><span class="item-title">${escapeHtml(item.name)}</span><span class="item-description">${escapeHtml(item.description || item.reason || '')}</span></div>
      <span class="item-qty">${item.quantity}</span>
      <span class="item-price">${formatMoney(item.lineTotal, quote.currency)}</span>
    </div>`).join('');

  const questions = $('#question-box');
  if (quote.questions?.length) {
    questions.classList.remove('hidden');
    $('#question-list').innerHTML = quote.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('');
  } else {
    questions.classList.add('hidden');
  }

  const badge = statusBadge;
  const statusText = quote.status === 'PAID' ? 'Paid' : quote.status === 'SENT' ? 'Invoice sent' : quote.questions?.length ? 'Needs review' : 'Draft ready';
  badge.className = `draft-badge ${quote.status === 'PAID' ? 'paid' : quote.status === 'SENT' ? 'sent' : 'draft'}`;
  badge.innerHTML = `<span></span> ${statusText}`;
  if (isNewQuote) $('#quote-count').textContent = String(Number($('#quote-count').textContent || 0) + 1);
  updateInvoiceButton();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function loadConfig() {
  try {
    state.config = await api('/api/config');
    updateConnection();
    $('#char-count').textContent = `${requestInput.value.length} / 2,000`;
  } catch {
    $('#connection-pill').lastElementChild.textContent = 'Server unavailable';
  }
}

requestInput.addEventListener('input', () => {
  $('#char-count').textContent = `${requestInput.value.length} / 2,000`;
});

$('#focus-request').addEventListener('click', () => {
  requestInput.focus();
  $('#workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#edit-request').addEventListener('click', () => {
  requestInput.focus();
  requestInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  state.busy = true;
  const button = $('#generate-button');
  button.disabled = true;
  button.innerHTML = '<span class="button-spark">✳</span> Reading request…';
  setMessage('Checking the request against your catalog…');
  try {
    const data = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({ request: requestInput.value, customerEmail: emailInput.value })
    });
    drawQuote(data.quote, data.aiConfigured);
    setMessage(data.aiConfigured ? 'AI quote ready — please review every line before sending.' : 'Preview quote ready. Add an AI key for live language processing.', 'success');
    if (data.quote.questions.length) showToast('A few order details need your review.');
    else showToast('Quote ready for your review.');
  } catch (error) {
    setMessage(error.message);
  } finally {
    state.busy = false;
    button.disabled = false;
    button.innerHTML = '<span class="button-spark">✳</span> Create AI quote <span class="button-arrow">→</span>';
    updateInvoiceButton();
  }
});

emailInput.addEventListener('input', () => {
  if (state.quote) {
    state.quote.customerEmail = emailInput.value.trim();
    $('#customer-email-display').textContent = emailInput.value.trim() || 'Add an email before you invoice';
    updateInvoiceButton();
  }
});

sendButton.addEventListener('click', async () => {
  if (!state.quote || sendButton.disabled || state.busy) return;
  if (!emailInput.value.trim()) {
    emailInput.focus();
    setMessage('Add the customer email before sending their PayPal invoice.');
    return;
  }
  if (!window.confirm(`Send a PayPal invoice for ${formatMoney(state.quote.total, state.quote.currency)} to ${emailInput.value.trim()}?`)) return;
  state.busy = true;
  updateInvoiceButton();
  setMessage('Creating and sending the PayPal invoice…');
  try {
    const result = await api('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ quoteId: state.quote.id, customerEmail: emailInput.value.trim() })
    });
    drawQuote(result.quote, state.config.aiConfigured);
    setMessage(`Invoice ${result.invoiceId} sent to ${emailInput.value.trim()}.`, 'success');
    $('#invoice-note').textContent = `PayPal invoice ${result.invoiceId} was emailed to the customer.`;
    addActivity(result.quote);
    showToast('PayPal invoice sent successfully.');
  } catch (error) {
    setMessage(error.message);
    showToast(error.message);
  } finally {
    state.busy = false;
    updateInvoiceButton();
  }
});

function addActivity(quote) {
  const row = document.createElement('div');
  row.className = 'activity-row new-activity';
  const customer = quote.customerEmail ? quote.customerEmail.split('@')[0] : 'Customer';
  row.innerHTML = `
    <div class="activity-symbol sent">↗</div>
    <div class="activity-copy"><strong>Invoice sent <span>· ${escapeHtml(quote.invoiceId || quote.id)}</span></strong><span>${escapeHtml(quote.summary)} · ${escapeHtml(customer)}</span></div>
    <div class="activity-amount neutral">${formatMoney(quote.total, quote.currency)}</div>
    <div class="activity-time">Just now</div><span class="activity-more">···</span>`;
  $('#activity-list').prepend(row);
}

loadConfig();
