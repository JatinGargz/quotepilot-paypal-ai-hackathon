const pageQuery = (selector) => document.querySelector(selector);
const cleanText = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function pageMoney(value, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value) || 0); }
  catch { return `${currency} ${Number(value) || 0}`; }
}

function pageDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function displayName(email = '') {
  const localPart = email.split('@')[0] || 'New customer';
  return localPart.split(/[._-]/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || 'New customer';
}

function showWorkspaceToast(message) {
  const toast = pageQuery('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showWorkspaceToast.timer);
  showWorkspaceToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function initProfileMenu() {
  const button = pageQuery('#profile-menu-button');
  const menu = pageQuery('#profile-menu');
  if (!button || !menu) return;

  const closeMenu = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });

  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target) && event.target !== button) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  pageQuery('#copy-demo-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      showWorkspaceToast('Demo link copied.');
    } catch {
      showWorkspaceToast(`Demo link: ${window.location.origin}`);
    }
    closeMenu();
  });
}

async function getWorkspaceData(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Could not load data (${response.status}).`);
  return data;
}

function updateConnectionStatus(config) {
  const pill = pageQuery('#connection-pill');
  if (!pill) return;
  const connected = config.aiConfigured && config.paypalConfigured;
  pill.className = `connection-pill ${connected ? 'ready' : 'preview'}`;
  pill.lastElementChild.textContent = connected ? 'AI + PayPal connected' : 'Preview mode';
}

function setEmptyState(target, heading, copy) {
  target.innerHTML = `<div class="empty-state"><span class="empty-state-icon">✳</span><h3>${cleanText(heading)}</h3><p>${cleanText(copy)}</p><a class="text-link" href="/">Create a quote <span>→</span></a></div>`;
}

function statusInfo(status) {
  if (status === 'PAID') return { label: 'Paid', className: 'paid', activity: 'Payment received', icon: '✓' };
  if (status === 'SENT') return { label: 'Invoice sent', className: 'sent', activity: 'Invoice sent', icon: '↗' };
  return { label: 'Draft', className: 'draft', activity: 'Quote drafted', icon: '✳' };
}

function renderQuotes(quotes) {
  const target = pageQuery('#quotes-list');
  if (!target) return;
  if (!quotes.length) return setEmptyState(target, 'No quotes yet', 'Your new AI-assisted quotes will appear here for review.');

  target.innerHTML = quotes.map((quote) => {
    const status = statusInfo(quote.status);
    const person = quote.customerEmail ? displayName(quote.customerEmail) : 'Customer email not added';
    const itemCount = Array.isArray(quote.items) ? quote.items.reduce((count, item) => count + (Number(item.quantity) || 0), 0) : 0;
    return `<article class="record-card">
      <div class="record-symbol ${status.className}">${status.icon}</div>
      <div class="record-main"><div class="record-title-row"><h3>${cleanText(quote.summary || 'Quote draft')}</h3><span class="record-status ${status.className}">${status.label}</span></div>
        <p>${cleanText(person)} <span>·</span> ${itemCount} item${itemCount === 1 ? '' : 's'} <span>·</span> ${cleanText(quote.id)}</p>
        <span class="record-date">${pageDate(quote.createdAt)}</span></div>
      <strong class="record-amount">${pageMoney(quote.total, quote.currency)}</strong>
    </article>`;
  }).join('');
}

function renderCustomers(quotes) {
  const target = pageQuery('#customers-list');
  if (!target) return;
  const customerMap = new Map();
  for (const quote of quotes) {
    const email = String(quote.customerEmail || '').trim().toLowerCase();
    if (!email) continue;
    const record = customerMap.get(email) || { email, quotes: [], totalPaid: 0 };
    record.quotes.push(quote);
    if (quote.status === 'PAID') record.totalPaid += Number(quote.total) || 0;
    customerMap.set(email, record);
  }
  const customers = [...customerMap.values()].sort((a, b) => (b.quotes[0]?.createdAt || '').localeCompare(a.quotes[0]?.createdAt || ''));
  const quoteTotal = customers.reduce((sum, customer) => sum + customer.quotes.length, 0);
  if (pageQuery('#customer-total')) pageQuery('#customer-total').textContent = String(customers.length);
  if (pageQuery('#customer-quote-total')) pageQuery('#customer-quote-total').textContent = String(quoteTotal);
  if (!customers.length) return setEmptyState(target, 'Your customer list is ready to grow', 'Add a customer email while creating a quote and they will appear here.');

  target.innerHTML = customers.map((customer) => {
    const latest = customer.quotes[0];
    const name = displayName(customer.email);
    const initials = name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    return `<article class="record-card customer-record">
      <div class="customer-avatar">${cleanText(initials)}</div>
      <div class="record-main"><h3>${cleanText(name)}</h3><p>${cleanText(customer.email)}</p><span class="record-date">Last quote ${pageDate(latest.createdAt)}</span></div>
      <div class="customer-summary"><strong>${customer.quotes.length}</strong><span>quote${customer.quotes.length === 1 ? '' : 's'}</span></div>
      <strong class="record-amount">${pageMoney(customer.totalPaid, latest.currency)}</strong>
    </article>`;
  }).join('');
}

function renderActivity(quotes) {
  const target = pageQuery('#activity-list-page');
  if (!target) return;
  if (!quotes.length) return setEmptyState(target, 'Nothing here yet', 'When you create a quote or send an invoice, the update will appear here.');

  target.innerHTML = quotes.map((quote) => {
    const status = statusInfo(quote.status);
    const customer = quote.customerEmail ? displayName(quote.customerEmail) : 'No customer email';
    return `<article class="record-card activity-record">
      <div class="record-symbol ${status.className}">${status.icon}</div>
      <div class="record-main"><div class="record-title-row"><h3>${status.activity}</h3><span class="record-status ${status.className}">${status.label}</span></div>
        <p>${cleanText(quote.summary || 'Quote draft')} <span>·</span> ${cleanText(customer)}</p>
        <span class="record-date">${pageDate(quote.createdAt, true)} <span>·</span> ${cleanText(quote.id)}</span></div>
      <strong class="record-amount">${pageMoney(quote.total, quote.currency)}</strong>
    </article>`;
  }).join('');
}

async function loadWorkspace() {
  const quoteCount = pageQuery('#quote-count');
  try {
    const [config, quoteData] = await Promise.all([
      getWorkspaceData('/api/config'),
      getWorkspaceData('/api/quotes')
    ]);
    updateConnectionStatus(config);
    const quotes = Array.isArray(quoteData.quotes) ? quoteData.quotes : [];
    if (quoteCount) quoteCount.textContent = String(quotes.length);
    if (pageQuery('#stat-total')) pageQuery('#stat-total').textContent = String(quotes.length);
    if (pageQuery('#stat-drafts')) pageQuery('#stat-drafts').textContent = String(quotes.filter((quote) => quote.status === 'DRAFT').length);
    if (pageQuery('#stat-invoices')) pageQuery('#stat-invoices').textContent = String(quotes.filter((quote) => quote.status === 'SENT' || quote.status === 'PAID').length);
    renderQuotes(quotes);
    renderCustomers(quotes);
    renderActivity(quotes);
  } catch (error) {
    for (const selector of ['#quotes-list', '#customers-list', '#activity-list-page']) {
      const target = pageQuery(selector);
      if (target) target.innerHTML = `<div class="empty-state"><h3>Couldn’t load this page</h3><p>${cleanText(error.message)}</p><button class="secondary-button" type="button" onclick="location.reload()">Try again</button></div>`;
    }
    const pill = pageQuery('#connection-pill');
    if (pill) pill.lastElementChild.textContent = 'Server unavailable';
  }
}

initProfileMenu();
loadWorkspace();
