/* ==========================================================================
   StorePulse — script.js
   Plain JavaScript, no libraries. The structure follows the PDF's required
   order: constants, helpers, rendering, events, start-up.

   The design language (named constants, small functions with one job,
   honest comments, bilingual messages) is carried over from api.html.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Constants — named values replace magic numbers and strings.
   -------------------------------------------------------------------------- */
const API_BASE_URL = 'https://fakestoreapi.com';
const SEARCH_DEBOUNCE_MS = 350;
const REQUEST_TIMEOUT_MS = 15000;
const RECENT_SEARCH_LIMIT = 5;
const TOAST_DURATION_MS = 3200;
const FALLBACK_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23e2e8f0'/%3E%3Ctext x='200' y='158' text-anchor='middle' font-family='sans-serif' font-size='24' fill='%23475569'%3ENo image available%3C/text%3E%3C/svg%3E";

const THEMES = ['light', 'dark', 'sunrise'];
const THEME_COLOURS = { light: '#4f46e5', dark: '#0b0f19', sunrise: '#c2410c' };
const THEME_LABELS = { light: '☀️ Light / فاتح', dark: '☾ Dark / داكن', sunrise: '🌅 Sunrise / شروق' };
const LANGS = ['both', 'en', 'ar'];
const LANG_LABELS = { ar: 'ع', both: 'EN+ع', en: 'EN' };
const LANG_NAMES = { ar: 'Arabic / العربية', both: 'Both / كلاهما', en: 'English / الإنجليزية' };
const PAGE_SIZES = [5, 10, 20];

const LOCAL_KEYS = {
  theme: 'storepulse_theme',
  language: 'storepulse_api_lang',
  favourites: 'storepulse_favourites',
  cart: 'storepulse_cart',
  recentSearches: 'storepulse_recent_searches',
  view: 'storepulse_view',
  pageSize: 'storepulse_page_size'
};

const SESSION_KEYS = {
  token: 'storepulse_token',
  username: 'storepulse_username',
  filters: 'storepulse_filters',
  page: 'storepulse_page',
  draft: 'storepulse_product_draft'
};

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized',
  404: 'Not Found', 500: 'Server Error'
};

const DEFAULT_FILTERS = {
  category: 'all',
  sort: '',
  limit: 0,
  search: '',
  browserSort: ''
};

/* --------------------------------------------------------------------------
   2. One state object — every screen is rendered from this (PDF M4).
   -------------------------------------------------------------------------- */
const state = {
  products: [],
  categories: [],
  filteredProducts: [],
  /* FakeStoreAPI only echoes writes; keep them in memory so CRUD is visible. */
  localProducts: [],
  editedProducts: {},
  deletedIds: [],
  filters: { ...DEFAULT_FILTERS },
  page: 1,
  pageSize: 10,
  view: 'grid',
  status: 'loading',
  error: '',
  favourites: [],
  cart: [],
  recentSearches: [],
  token: '',
  username: '',
  draft: null,
  editingProductId: null,
  inputEvents: 0,
  filterRuns: 0,
  confirmAction: null,
  toastTimer: null,
  debounceTimer: null,
  searchTimer: null, langFadeTimer: null
};

/* --------------------------------------------------------------------------
   3. Small helpers — safe storage, formatting and DOM lookup.
   -------------------------------------------------------------------------- */
function byId(id) {
  return document.getElementById(id);
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return raw;
    }
  } catch (error) {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* Storage may be blocked; the page still works without it. */
  }
}

function attachImageFallback(image) {
  image.addEventListener('error', () => {
    if (image.src !== FALLBACK_IMAGE) image.src = FALLBACK_IMAGE;
  });
}

function formatPrice(priceInDollars) {
  const amount = Number(priceInDollars);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '$0.00';
}

function formatRating(product) {
  const rating = product && product.rating ? product.rating : {};
  const rate = Number(rating.rate);
  const count = Number(rating.count);
  if (!Number.isFinite(rate)) return '★ —';
  return `★ ${rate.toFixed(1)} (${Number.isFinite(count) ? count : 0} reviews)`;
}

function isFavourite(productId) {
  return state.favourites.some((id) => Number(id) === Number(productId));
}

function persistLocalState() {
  writeJson(localStorage, LOCAL_KEYS.favourites, state.favourites);
  writeJson(localStorage, LOCAL_KEYS.cart, state.cart);
  writeJson(localStorage, LOCAL_KEYS.recentSearches, state.recentSearches);
  writeJson(localStorage, LOCAL_KEYS.view, state.view);
  writeJson(localStorage, LOCAL_KEYS.pageSize, state.pageSize);
}

function persistSessionState() {
  writeJson(sessionStorage, SESSION_KEYS.token, state.token);
  writeJson(sessionStorage, SESSION_KEYS.username, state.username);
  writeJson(sessionStorage, SESSION_KEYS.filters, state.filters);
  writeJson(sessionStorage, SESSION_KEYS.page, state.page);
}

function hideToast() {
  window.clearTimeout(state.toastTimer);
  const toast = byId('toast');
  toast.hidden = true;
  if (toast.parentElement !== document.body) document.body.append(toast);
}

function showToast(message, tone = 'info', arabicMessage = '') {
  const toast = byId('toast');
  const safeTone = ['success', 'info', 'error'].includes(tone) ? tone : 'info';
  window.clearTimeout(state.toastTimer);
  toast.className = `toast toast-${safeTone}`;
  toast.replaceChildren();

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = safeTone === 'success' ? '✓' : safeTone === 'error' ? '!' : 'i';

  const text = document.createElement('span');
  text.className = 'toast-text';
  if (arabicMessage) {
    const en = document.createElement('span');
    en.className = 'bi-en';
    en.lang = 'en';
    en.textContent = message;
    const ar = document.createElement('span');
    ar.className = 'bi-ar';
    ar.lang = 'ar';
    ar.dir = 'rtl';
    ar.textContent = arabicMessage;
    text.append(en, ar);
  } else {
    text.textContent = message;
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss message • إخفاء الرسالة');
  close.textContent = '×';
  close.addEventListener('click', hideToast);

  toast.append(icon, text, close);
  /* Native dialogs use the top layer, so feedback shown from a dialog must live inside it. */
  const host = document.querySelector('dialog[open]') || document.body;
  if (toast.parentElement !== host) host.append(toast);
  toast.hidden = false;
  state.toastTimer = window.setTimeout(hideToast, TOAST_DURATION_MS);
}

/* --------------------------------------------------------------------------
   4. Restore state — only the items allowed by the PDF storage map.
   -------------------------------------------------------------------------- */
function restoreState() {
  state.favourites = readJson(localStorage, LOCAL_KEYS.favourites, []);
  state.cart = readJson(localStorage, LOCAL_KEYS.cart, []);
  state.recentSearches = readJson(localStorage, LOCAL_KEYS.recentSearches, []);
  state.view = readJson(localStorage, LOCAL_KEYS.view, 'grid');
  state.pageSize = Number(readJson(localStorage, LOCAL_KEYS.pageSize, 10));

  state.token = readJson(sessionStorage, SESSION_KEYS.token, '');
  state.username = readJson(sessionStorage, SESSION_KEYS.username, '');
  state.draft = readJson(sessionStorage, SESSION_KEYS.draft, null);

  const savedFilters = readJson(sessionStorage, SESSION_KEYS.filters, {});
  state.filters = {
    category: savedFilters.category || DEFAULT_FILTERS.category,
    sort: savedFilters.sort || DEFAULT_FILTERS.sort,
    limit: Number(savedFilters.limit) || DEFAULT_FILTERS.limit,
    search: savedFilters.search || DEFAULT_FILTERS.search,
    browserSort: savedFilters.browserSort || DEFAULT_FILTERS.browserSort
  };

  state.page = Number(readJson(sessionStorage, SESSION_KEYS.page, 1)) || 1;
  if (!PAGE_SIZES.includes(state.pageSize)) state.pageSize = 10;
  if (state.view !== 'table') state.view = 'grid';

  /* Defensive copies: a malformed saved value must never break rendering. */
  if (!Array.isArray(state.favourites)) state.favourites = [];
  if (!Array.isArray(state.cart)) state.cart = [];
  if (!Array.isArray(state.recentSearches)) state.recentSearches = [];
}

/* --------------------------------------------------------------------------
   5. API access — build URLs safely and turn responses into data.
   -------------------------------------------------------------------------- */
function buildProductsUrl() {
  const categoryPath = state.filters.category === 'all'
    ? '/products'
    : `/products/category/${encodeURIComponent(state.filters.category)}`;

  const parameters = new URLSearchParams();
  if (Number(state.filters.limit) > 0) parameters.set('limit', String(state.filters.limit));
  if (state.filters.sort) parameters.set('sort', state.filters.sort);

  const query = parameters.toString();
  return `${API_BASE_URL}${categoryPath}${query ? `?${query}` : ''}`;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const label = STATUS_TEXT[response.status] || response.statusText || 'Error';
      throw new Error(`HTTP ${response.status} ${label}`.trim());
    }

    const text = await response.text();
    if (!text.trim()) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error('The response was not valid JSON.');
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out.');
    if (error instanceof TypeError) throw new Error('Network unavailable. Check your connection.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/* FakeStoreAPI does not persist writes, so merge our in-memory results into reads. */
function sameProductId(first, second) {
  return Number(first) === Number(second);
}

function mergeCatalogue(serverProducts) {
  const source = Array.isArray(serverProducts) ? serverProducts : [];
  const preserved = source
    .filter((product) => !state.deletedIds.some((id) => sameProductId(id, product.id)))
    .map((product) => {
      const edited = state.editedProducts[product.id] || state.editedProducts[String(product.id)];
      return edited ? { ...product, ...edited } : product;
    });

  const usedIds = new Set(preserved.map((product) => Number(product.id)));
  const additions = state.localProducts.filter((product) => {
    if (state.filters.category !== 'all' && product.category !== state.filters.category) return false;
    if (usedIds.has(Number(product.id))) return false;
    usedIds.add(Number(product.id));
    return true;
  });

  return [...additions, ...preserved];
}

function rememberCategory(category) {
  const clean = String(category || '').trim();
  if (!clean || state.categories.includes(clean)) return;
  state.categories = [...state.categories, clean];
}

async function loadCatalogue() {
  state.status = 'loading';
  render();

  try {
    const [categories, products] = await Promise.all([
      requestJson(`${API_BASE_URL}/products/categories`),
      requestJson(buildProductsUrl())
    ]);

    state.categories = Array.isArray(categories) ? [...categories] : [];
    state.localProducts.forEach((product) => rememberCategory(product.category));
    state.products = mergeCatalogue(products);
    state.error = '';
    state.status = 'ready';
    populateCategorySelect();
    applyLocalFilters();
  } catch (error) {
    state.products = [];
    state.filteredProducts = [];
    state.error = error.message;
    state.status = 'error';
  }

  render();
}

async function reloadProducts() {
  state.status = 'loading';
  render();

  try {
    const products = await requestJson(buildProductsUrl());
    state.products = mergeCatalogue(products);
    populateCategorySelect();
    state.error = '';
    state.status = 'ready';
    applyLocalFilters();
  } catch (error) {
    state.products = [];
    state.filteredProducts = [];
    state.error = error.message;
    state.status = 'error';
  }

  render();
}

/* --------------------------------------------------------------------------
   6. Local filtering, browser sorting and pagination.
   -------------------------------------------------------------------------- */
function applyLocalFilters() {
  const term = state.filters.search.trim().toLowerCase();
  let items = state.products.filter((product) => {
    const title = String(product.title || '').toLowerCase();
    const category = String(product.category || '').toLowerCase();
    return !term || title.includes(term) || category.includes(term);
  });

  const comparator = {
    'price-asc': (first, second) => Number(first.price) - Number(second.price),
    'price-desc': (first, second) => Number(second.price) - Number(first.price),
    'rating-desc': (first, second) => Number(second.rating?.rate || 0) - Number(first.rating?.rate || 0),
    'title-asc': (first, second) => String(first.title).localeCompare(String(second.title))
  }[state.filters.browserSort];

  if (comparator) items = [...items].sort(comparator);
  state.filteredProducts = items;

  const lastPage = Math.max(1, Math.ceil(items.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), lastPage);
  persistSessionState();
}

function pageSlice() {
  const startIndex = (state.page - 1) * state.pageSize;
  return state.filteredProducts.slice(startIndex, startIndex + state.pageSize);
}

function pageCount() {
  return Math.max(1, Math.ceil(state.filteredProducts.length / state.pageSize));
}

/* --------------------------------------------------------------------------
   7. Rendering — every function updates one part of the screen.
   -------------------------------------------------------------------------- */
function populateCategorySelect() {
  const select = byId('category-select');
  const selected = state.filters.category;
  select.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All • الكل';
  select.append(allOption);

  state.categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.append(option);
  });

  select.value = state.categories.includes(selected) ? selected : 'all';
  state.filters.category = select.value;
}

function renderFilterControls() {
  byId('category-select').value = state.filters.category;
  byId('server-sort-select').value = state.filters.sort;
  byId('server-limit-select').value = String(state.filters.limit);
  byId('page-size-select').value = String(state.pageSize);
  byId('browser-sort-select').value = state.filters.browserSort;
  byId('search-input').value = state.filters.search;

  byId('grid-view').setAttribute('aria-pressed', String(state.view === 'grid'));
  byId('table-view').setAttribute('aria-pressed', String(state.view === 'table'));
  byId('product-grid').hidden = state.view !== 'grid';
  byId('product-table-wrap').hidden = state.view !== 'table';
}

function renderSummary() {
  const summary = byId('result-summary');
  if (state.status === 'loading') {
    summary.textContent = 'Loading products… / جارٍ تحميل المنتجات…';
    return;
  }
  if (state.status === 'error') {
    summary.textContent = 'Could not load products. / تعذّر تحميل المنتجات.';
    return;
  }

  const total = state.filteredProducts.length;
  const first = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const last = Math.min(state.page * state.pageSize, total);
  const serverFiltered = state.filters.category !== 'all' || Number(state.filters.limit) > 0 || Boolean(state.filters.sort);
  const suffix = serverFiltered ? ' (filtered by the API)' : '';
  summary.textContent = `Showing ${first}–${last} of ${total} products${suffix}`;
}

function renderStatus() {
  const panel = byId('status-message');
  panel.replaceChildren();

  if (state.status === 'loading') {
    panel.hidden = false;
    panel.dataset.state = 'loading';
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    const text = document.createElement('p');
    text.textContent = 'Fetching products from FakeStoreAPI…';
    panel.append(bar, text);
    return;
  }

  if (state.status === 'error') {
    panel.hidden = false;
    panel.dataset.state = 'error';
    const text = document.createElement('p');
    text.textContent = `Request failed: ${state.error}`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-outline';
    retry.dataset.action = 'retry';
    retry.textContent = 'Try again';
    panel.append(text, retry);
    return;
  }

  if (state.filteredProducts.length === 0) {
    panel.hidden = false;
    panel.dataset.state = 'empty';
    const text = document.createElement('p');
    text.textContent = 'No products match these filters. Try clearing the search or category.';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-outline';
    clear.dataset.action = 'clear';
    clear.textContent = 'Clear filters / مسح المرشحات';
    panel.append(text, clear);
    return;
  }

  panel.hidden = true;
  delete panel.dataset.state;
}

function createProductCard(product) {
  const fragment = byId('product-card-template').content.cloneNode(true);
  const card = fragment.querySelector('.product-card');
  card.dataset.id = String(product.id);

  const image = card.querySelector('.product-image');
  image.src = product.image || '';
  image.alt = product.title || 'Product image';
  image.loading = 'lazy';
  attachImageFallback(image);

  const category = product.category || '';
  card.querySelector('.category-badge').textContent = category;
  card.querySelector('.card-media').setAttribute('aria-label',
    `View details for ${product.title || 'product'}, ${category || 'uncategorized'} • عرض تفاصيل المنتج`);
  card.querySelector('.title-button').textContent = product.title || '';
  card.querySelector('.product-description').textContent = product.description || '';
  card.querySelector('.product-price').textContent = formatPrice(product.price);
  card.querySelector('.product-rating').textContent = formatRating(product);

  const favourite = card.querySelector('.favourite-button');
  const active = isFavourite(product.id);
  favourite.setAttribute('aria-pressed', String(active));
  favourite.querySelector('span').textContent = active ? '♥' : '♡';

  return fragment;
}

function createTableRow(product) {
  const row = document.createElement('tr');
  row.dataset.id = String(product.id);

  const imageCell = document.createElement('td');
  const image = document.createElement('img');
  image.className = 'table-image';
  image.src = product.image || '';
  image.alt = product.title || 'Product image';
  image.loading = 'lazy';
  attachImageFallback(image);
  const imageButton = document.createElement('button');
  imageButton.type = 'button';
  imageButton.className = 'table-image-button';
  imageButton.dataset.action = 'detail';
  imageButton.setAttribute('aria-label', `View details for ${product.title || 'product'} • عرض تفاصيل المنتج`);
  imageButton.append(image);
  imageCell.append(imageButton);

  const values = [product.title || '', product.category || '', formatPrice(product.price), formatRating(product)];
  const cells = [imageCell];
  values.forEach((value) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    cells.push(cell);
  });

  const actionCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'table-actions';
  [
    ['detail', 'Details'], ['cart', 'Cart'], ['favourite', isFavourite(product.id) ? '♥' : '♡'],
    ['edit', 'Edit'], ['delete', 'Delete']
  ].forEach(([action, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ({ detail: 'btn btn-outline', cart: 'btn btn-primary', favourite: 'btn btn-icon favourite-button', edit: 'btn btn-outline', delete: 'btn btn-danger' })[action];
    button.dataset.action = action;
    button.textContent = label;
    if (action === 'favourite') button.setAttribute('aria-pressed', String(isFavourite(product.id)));
    actions.append(button);
  });
  actionCell.append(actions);
  cells.push(actionCell);

  row.append(...cells);
  return row;
}

function renderProducts() {
  const grid = byId('product-grid');
  const tableBody = byId('product-table-body');
  grid.replaceChildren();
  tableBody.replaceChildren();

  if (state.status !== 'ready' || state.filteredProducts.length === 0) return;

  const visible = pageSlice();
  if (state.view === 'grid') {
    visible.forEach((product) => grid.append(createProductCard(product)));
  } else {
    visible.forEach((product) => tableBody.append(createTableRow(product)));
  }
}

function renderPagination() {
  const nav = byId('pagination');
  nav.replaceChildren();
  if (state.status !== 'ready' || state.filteredProducts.length === 0) return;

  const totalPages = pageCount();
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'btn btn-outline';
  previous.dataset.page = String(state.page - 1);
  previous.textContent = '‹';
  previous.setAttribute('aria-label', 'Previous page');
  previous.disabled = state.page === 1;
  nav.append(previous);

  for (let number = 1; number <= totalPages; number += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.dataset.page = String(number);
    button.textContent = String(number);
    button.setAttribute('aria-label', `Page ${number}`);
    if (number === state.page) button.setAttribute('aria-current', 'page');
    nav.append(button);
  }

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-outline';
  next.dataset.page = String(state.page + 1);
  next.textContent = '›';
  next.setAttribute('aria-label', 'Next page');
  next.disabled = state.page === totalPages;
  nav.append(next);
}

function renderCart() {
  const list = byId('cart-items');
  list.replaceChildren();

  state.cart.forEach((item) => {
    const row = document.createElement('li');
    row.className = 'cart-item';
    row.dataset.id = String(item.id);

    const title = document.createElement('span');
    title.className = 'cart-item-title';
    title.textContent = item.title || `Product ${item.id}`;

    const quantity = document.createElement('span');
    quantity.className = 'quantity-controls';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'btn btn-outline';
    minus.dataset.action = 'quantity-minus';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Decrease quantity of ${item.title}`);
    const count = document.createElement('span');
    count.textContent = String(item.quantity);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'btn btn-outline';
    plus.dataset.action = 'quantity-plus';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Increase quantity of ${item.title}`);
    quantity.append(minus, count, plus);

    const price = document.createElement('span');
    price.textContent = formatPrice(Number(item.price) * Number(item.quantity));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-danger';
    remove.dataset.action = 'cart-remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Remove ${item.title} from cart`);

    row.append(title, quantity, price, remove);
    list.append(row);
  });

  const total = state.cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  byId('cart-total').textContent = formatPrice(total);
  const cartItemCount = state.cart.reduce((sum, item) => sum + Number(item.quantity), 0); byId('cart-count').textContent = String(cartItemCount); byId('cart-open').setAttribute('aria-label', ({ ar: `السلة ${cartItemCount}`, en: `Cart ${cartItemCount}`, both: `Cart السلة ${cartItemCount}` })[document.documentElement.dataset.lang] || `السلة ${cartItemCount}`);
}

function renderAccount() {
  const signedIn = Boolean(state.token);
  const username = state.username || 'user';
  const status = byId('account-status');
  status.querySelector('.bi-en').textContent = signedIn
    ? `Signed in as ${username} • token in sessionStorage`
    : 'Not signed in';
  status.querySelector('.bi-ar').textContent = signedIn
    ? `تم تسجيل الدخول باسم ${username} • الرمز في sessionStorage`
    : 'غير مسجل الدخول';
  byId('login-form').hidden = signedIn;
  byId('logout-button').hidden = !signedIn;
}

function renderRecentSearches() {
  const datalist = byId('recent-searches');
  datalist.replaceChildren();
  state.recentSearches.forEach((term) => {
    const option = document.createElement('option');
    option.value = term;
    datalist.append(option);
  });
}

function render() {
  renderFilterControls();
  renderSummary();
  renderStatus();
  renderProducts();
  renderPagination();
  renderCart();
  renderAccount();
  renderRecentSearches();
  updateScrollProgress();
}

/* --------------------------------------------------------------------------
   8. Theme and language — the only things that change are attributes.
   -------------------------------------------------------------------------- */
function applyTheme(theme) {
  const safe = THEMES.includes(theme) ? theme : 'light';
  document.documentElement.setAttribute('data-theme', safe);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOURS[safe]);
  byId('theme-button-label').textContent = THEME_LABELS[safe];
  byId('theme-cycle').setAttribute('aria-label', `Change colour theme • ${THEME_LABELS[safe]}`);
  return safe;
}

function setupTheme() {
  const saved = readJson(localStorage, LOCAL_KEYS.theme, null);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(THEMES.includes(saved) ? saved : (prefersDark ? 'dark' : 'light'));

  byId('theme-cycle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    writeJson(localStorage, LOCAL_KEYS.theme, applyTheme(next));
  });
}

function applyLang(mode, animate = false) {
  const safe = LANGS.includes(mode) ? mode : 'ar'; const root = document.documentElement;
  root.classList.toggle('lang-shifting', animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches); void root.offsetWidth;
  window.clearTimeout(state.langFadeTimer); state.langFadeTimer = root.classList.contains('lang-shifting') ? window.setTimeout(() => root.classList.remove('lang-shifting'), 150) : null;
  root.setAttribute('data-lang', safe); root.setAttribute('lang', safe === 'ar' ? 'ar' : 'en'); root.setAttribute('dir', safe === 'ar' ? 'rtl' : 'ltr');
  byId('lang-button-label').textContent = LANG_LABELS[safe];
  byId('lang-cycle').setAttribute('aria-label', `Change language • ${LANG_LABELS[safe]} (${LANG_NAMES[safe]})`); renderCart();
  return safe;
}

function setupLanguage() {
  const saved = readJson(localStorage, LOCAL_KEYS.language, 'ar');
  applyLang(saved);

  byId('lang-cycle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-lang');
    const next = LANGS[(LANGS.indexOf(current) + 1) % LANGS.length];
    writeJson(localStorage, LOCAL_KEYS.language, applyLang(next, true));
  });
}

/* --------------------------------------------------------------------------
   9. Filters, debounce and pagination events.
   -------------------------------------------------------------------------- */
function resetToFirstPage() {
  state.page = 1;
  persistSessionState();
}

function recordRecentSearch(term) {
  const clean = term.trim();
  if (!clean) return;
  state.recentSearches = [clean, ...state.recentSearches.filter((item) => item !== clean)].slice(0, RECENT_SEARCH_LIMIT);
  persistLocalState();
}

function setupFilters() {
  byId('search-input').addEventListener('input', (event) => {
    state.inputEvents += 1;
    window.clearTimeout(state.debounceTimer);
    /* Capture now: a request finishing during the wait may re-render the input. */
    const typed = event.target.value;

    /* PDF 7.2: debounce written with setTimeout + clearTimeout, no library. */
    state.debounceTimer = window.setTimeout(() => {
      state.filterRuns += 1;
      state.filters.search = typed;
      recordRecentSearch(typed);
      resetToFirstPage();
      applyLocalFilters();
      render();
      console.log(`Search input events: ${state.inputEvents}; debounced filter runs: ${state.filterRuns}`);
    }, SEARCH_DEBOUNCE_MS);
  });

  [
    ['category-select', 'category'],
    ['server-sort-select', 'sort'],
    ['server-limit-select', 'limit']
  ].forEach(([elementId, key]) => {
    byId(elementId).addEventListener('change', (event) => {
      state.filters[key] = key === 'limit' ? Number(event.target.value) : event.target.value;
      resetToFirstPage();
      reloadProducts();
    });
  });

  byId('page-size-select').addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    resetToFirstPage();
    persistLocalState();
    applyLocalFilters();
    render();
  });

  byId('browser-sort-select').addEventListener('change', (event) => {
    state.filters.browserSort = event.target.value;
    resetToFirstPage();
    applyLocalFilters();
    render();
  });

  byId('clear-filters').addEventListener('click', () => {
    state.filters = { ...DEFAULT_FILTERS };
    byId('search-input').value = '';
    resetToFirstPage();
    reloadProducts();
  });

  byId('pagination').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page);
    persistSessionState();
    render();
  });

  byId('status-message').addEventListener('click', (event) => {
    if (event.target.closest('[data-action="retry"]')) loadCatalogue();
    if (event.target.closest('[data-action="clear"]')) byId('clear-filters').click();
  });

  byId('grid-view').addEventListener('click', () => switchView('grid'));
  byId('table-view').addEventListener('click', () => switchView('table'));
}

function switchView(view) {
  state.view = view === 'table' ? 'table' : 'grid';
  persistLocalState();
  render();
}

function setupMenu() {
  const button = byId('menu-toggle');
  const nav = byId('primary-nav');

  button.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    });
  });
}

let spaceOpener = null;

function openSpace(section) {
  const dialog = byId('space-dialog');
  spaceOpener = document.activeElement;
  dialog.dataset.section = section;
  dialog.classList.remove('is-closing');
  if (!dialog.open) dialog.showModal();

  const panel = byId(section === 'account' ? 'account-panel' : 'cart-panel');
  const firstControl = [...panel.querySelectorAll('button, input, a[href]')].find((el) => el.getClientRects().length > 0);
  if (firstControl) firstControl.focus({ preventScroll: true });
}

function closeSpace() {
  const dialog = byId('space-dialog');
  if (!dialog.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.add('is-closing');
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.removeEventListener('animationend', finish);
    dialog.classList.remove('is-closing');
    dialog.close();
  };
  dialog.addEventListener('animationend', finish);
  window.setTimeout(finish, 300);
}

function setupSpace() {
  const dialog = byId('space-dialog');
  byId('cart-open').addEventListener('click', () => openSpace('cart'));
  byId('account-open').addEventListener('click', () => openSpace('account'));
  byId('space-close').addEventListener('click', closeSpace);

  /* A backdrop click targets the dialog itself; compare coords to keep padding clicks open. */
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closeSpace();
  });

  /* Escape and the close button share the same animated exit path. */
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSpace();
  });

  dialog.addEventListener('close', () => {
    if (spaceOpener && document.contains(spaceOpener)) spaceOpener.focus();
    spaceOpener = null;
  });
}

/* --------------------------------------------------------------------------
   10. Product actions — one listener handles every card and table row.
   -------------------------------------------------------------------------- */
function handleProductAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const container = button.closest('[data-id]');
  if (!container) return;

  const productId = Number(container.dataset.id);
  const product = state.products.find((item) => Number(item.id) === productId);
  if (!product) return;

  switch (button.dataset.action) {
    case 'favourite':
      toggleFavourite(productId);
      break;
    case 'detail':
      openProductDetail(productId);
      break;
    case 'cart':
      addToCart(product);
      break;
    case 'edit':
      openProductForm(product);
      break;
    case 'delete':
      askBeforeDelete(product);
      break;
    default:
      break;
  }
}

function toggleFavourite(productId) {
  if (isFavourite(productId)) {
    state.favourites = state.favourites.filter((id) => Number(id) !== Number(productId));
  } else {
    state.favourites = [...state.favourites, Number(productId)];
  }
  persistLocalState();
  render();
}

async function openProductDetail(productId) {
  try {
    const product = await requestJson(`${API_BASE_URL}/products/${productId}`);
    if (!product || Array.isArray(product)) {
      showToast('The API returned no product for this id.', 'info', 'الـ API لم يُرجع منتجاً لهذا المعرّف.');
      return;
    }

    const detailImage = byId('detail-image');
    attachImageFallback(detailImage);
    byId('detail-title').textContent = product.title || 'Product details';
    detailImage.src = product.image || FALLBACK_IMAGE;
    detailImage.alt = product.title || 'Product image';
    byId('detail-category').textContent = product.category || '';
    byId('detail-price').textContent = formatPrice(product.price);
    byId('detail-rating').textContent = formatRating(product);
    byId('detail-description').textContent = product.description || '';

    const dialog = byId('detail-dialog');
    dialog.dataset.id = String(product.id);
    const favourite = byId('detail-favourite');
    const active = isFavourite(product.id);
    favourite.setAttribute('aria-pressed', String(active));
    favourite.textContent = active ? '♥' : '♡';
    favourite.setAttribute('aria-label', active
      ? 'Remove from favourites • إزالة من المفضلة'
      : 'Add to favourites • أضف للمفضلة');
    dialog.showModal();
  } catch (error) {
    showToast(`Detail request failed: ${error.message}`, 'error', `تعذّر تحميل التفاصيل: ${error.message}`);
  }
}

function addToCart(product) {
  const existing = state.cart.find((item) => Number(item.id) === Number(product.id));
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ id: Number(product.id), title: product.title, price: Number(product.price), quantity: 1 });
  }
  persistLocalState();
  render();
  showToast(`Added “${product.title}” to your cart`, 'success', `تمت إضافة «${product.title}» إلى سلتك`);
}

function changeCartQuantity(productId, delta) {
  const item = state.cart.find((entry) => Number(entry.id) === Number(productId));
  if (!item) return;
  item.quantity += delta;
  if (item.quantity < 1) state.cart = state.cart.filter((entry) => entry !== item);
  persistLocalState();
  render();
}

function setupCart() {
  byId('cart-items').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-id]');
    const productId = Number(row.dataset.id);

    if (button.dataset.action === 'quantity-plus') changeCartQuantity(productId, 1);
    if (button.dataset.action === 'quantity-minus') changeCartQuantity(productId, -1);
    if (button.dataset.action === 'cart-remove') {
      state.cart = state.cart.filter((item) => Number(item.id) !== productId);
      persistLocalState();
      render();
    }
  });

  byId('clear-cart').addEventListener('click', () => {
    state.cart = [];
    persistLocalState();
    render();
  });

  byId('checkout-button').addEventListener('click', checkout);
}

async function checkout() {
  if (state.cart.length === 0) {
    showToast('Your cart is empty.', 'info', 'سلتك فارغة.');
    return;
  }

  const body = {
    userId: 1,
    date: new Date().toISOString(),
    products: state.cart.map((item) => ({ productId: item.id, quantity: item.quantity }))
  };
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  try {
    const order = await requestJson(`${API_BASE_URL}/carts`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    const orderId = Number(order?.id);
    const suffix = Number.isFinite(orderId) ? ` #${orderId}` : '';
    showToast(`Order${suffix} sent successfully`, 'success', `تم إرسال الطلب${suffix ? ` رقم ${orderId}` : ''} بنجاح`);
    state.cart = [];
    persistLocalState();
    render();
  } catch (error) {
    showToast(`Checkout failed: ${error.message}`, 'error', `تعذّر إتمام الطلب: ${error.message}`);
  }
}

/* --------------------------------------------------------------------------
   11. Login, token and product writes.
   -------------------------------------------------------------------------- */
function setLoginPending(pending) {
  const submit = byId('login-submit');
  submit.disabled = pending;
  submit.setAttribute('aria-busy', String(pending));
  submit.querySelector('.bi-en').textContent = pending ? 'Signing in…' : 'Sign in';
  submit.querySelector('.bi-ar').textContent = pending ? 'جارٍ الدخول…' : 'تسجيل الدخول';
}

async function handleLogin(event) {
  event.preventDefault();
  const usernameInput = byId('login-username');
  const passwordInput = byId('login-password');
  const body = { username: usernameInput.value, password: passwordInput.value };
  passwordInput.value = '';
  setLoginPending(true);

  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(response.status === 401
        ? 'Wrong username or password (401). استخدم الحساب التجريبي الظاهر أدناه.'
        : `Login failed (HTTP ${response.status}).`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('Login response was not valid JSON.');
    }
    if (!data.token) throw new Error('The login response contained no token.');

    state.token = data.token;
    state.username = body.username;
    persistSessionState();
    render();
    showToast('Signed in. Token kept in sessionStorage only.', 'success', 'تم تسجيل الدخول. الرمز محفوظ في sessionStorage فقط.');
  } catch (error) {
    showToast(error.message, 'error', error.message);
  } finally {
    setLoginPending(false);
  }
}

function setupAccount() {
  byId('login-form').addEventListener('submit', handleLogin);

  byId('logout-button').addEventListener('click', () => {
    state.token = '';
    state.username = '';
    byId('login-username').value = '';
    byId('login-password').value = '';
    persistSessionState();
    render();
    showToast('Signed out; token removed.', 'info', 'تم تسجيل الخروج؛ حُذف الرمز.');
  });
}

function openConfirm(message, action) {
  state.confirmAction = action;
  byId('confirm-message').textContent = message;
  byId('confirm-dialog').showModal();
}

function setupDialogs() {
  byId('detail-close').addEventListener('click', () => byId('detail-dialog').close());

  byId('detail-cart').addEventListener('click', () => {
    const productId = Number(byId('detail-dialog').dataset.id);
    const product = state.products.find((item) => Number(item.id) === productId);
    if (product) addToCart(product);
  });

  byId('detail-favourite').addEventListener('click', () => {
    toggleFavourite(Number(byId('detail-dialog').dataset.id));
    const active = isFavourite(Number(byId('detail-dialog').dataset.id));
    const button = byId('detail-favourite');
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? '♥' : '♡';
    button.setAttribute('aria-label', active
      ? 'Remove from favourites • إزالة من المفضلة'
      : 'Add to favourites • أضف للمفضلة');
  });

  byId('confirm-cancel').addEventListener('click', () => byId('confirm-dialog').close());
  byId('confirm-accept').addEventListener('click', async () => {
    const action = state.confirmAction;
    state.confirmAction = null;
    byId('confirm-dialog').close();
    if (typeof action === 'function') await action();
  });

  byId('form-cancel').addEventListener('click', () => byId('product-form-dialog').close());

  [byId('detail-dialog'), byId('confirm-dialog'), byId('product-form-dialog')].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function openProductForm(product = null) {
  state.editingProductId = product ? Number(product.id) : null;
  const form = byId('product-form');
  form.reset();

  const draft = state.draft || {};
  byId('product-id').value = product ? String(product.id) : '';
  byId('product-title-input').value = product ? product.title || '' : draft.title || '';
  byId('product-price-input').value = product ? product.price ?? '' : draft.price ?? '';
  byId('product-image-input').value = product ? product.image || '' : draft.image || '';
  byId('product-category-input').value = product ? product.category || '' : draft.category || '';
  byId('product-description-input').value = product ? product.description || '' : draft.description || '';

  const title = byId('form-title');
  title.querySelector('.bi-en').textContent = product ? 'Edit product' : 'Add product';
  title.querySelector('.bi-ar').textContent = product ? 'تعديل منتج' : 'إضافة منتج';

  byId('product-form-dialog').showModal();
}

function saveDraft() {
  if (state.editingProductId) return;
  state.draft = {
    title: byId('product-title-input').value,
    price: byId('product-price-input').value,
    image: byId('product-image-input').value,
    category: byId('product-category-input').value,
    description: byId('product-description-input').value
  };
  writeJson(sessionStorage, SESSION_KEYS.draft, state.draft);
}

function buildProductPayload() {
  return {
    title: byId('product-title-input').value.trim(),
    price: Number(byId('product-price-input').value),
    description: byId('product-description-input').value.trim(),
    image: byId('product-image-input').value.trim(),
    category: byId('product-category-input').value.trim()
  };
}

async function handleProductSubmit(event) {
  event.preventDefault();
  const payload = buildProductPayload();
  if (!payload.title || !payload.image || !payload.category || !Number.isFinite(payload.price)) {
    showToast('Please fill the title, price, image and category.', 'error', 'يرجى إدخال العنوان والسعر والصورة والتصنيف.');
    return;
  }

  const editingId = byId('product-id').value;
  const url = editingId ? `${API_BASE_URL}/products/${editingId}` : `${API_BASE_URL}/products`;
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  try {
    const saved = await requestJson(url, {
      method: editingId ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const savedObject = saved && typeof saved === 'object' ? saved : {};
    const knownIds = [...state.products, ...state.localProducts].map((item) => Number(item.id));
    let id = Number(savedObject.id);
    if (!Number.isFinite(id) || knownIds.includes(id)) id = Math.max(0, ...knownIds) + 1;

    const product = {
      id,
      title: payload.title,
      price: payload.price,
      description: payload.description,
      image: payload.image,
      category: payload.category,
      rating: savedObject.rating || { rate: 0, count: 0 },
      ...savedObject
    };
    product.id = id;
    rememberCategory(product.category);

    if (editingId) {
      const originalId = Number(editingId);
      const updated = { ...product, id: originalId };
      state.editedProducts[originalId] = updated;
      state.products = state.products.map((item) => sameProductId(item.id, originalId) ? { ...item, ...updated } : item);
      state.localProducts = state.localProducts.map((item) => sameProductId(item.id, originalId) ? { ...item, ...updated } : item);
    } else {
      state.products = [product, ...state.products.filter((item) => !sameProductId(item.id, id))];
      state.localProducts = [product, ...state.localProducts.filter((item) => !sameProductId(item.id, id))];
    }

    /* Match the visible list to the selected category after the write. */
    state.filters.category = product.category;
    state.filters.search = '';
    state.page = 1;
    state.draft = null;
    writeJson(sessionStorage, SESSION_KEYS.draft, null);
    byId('product-form-dialog').close();
    /* Category filtering happens in the request URL, so re-request that category. */
    await reloadProducts();
    showToast(`${editingId ? 'Updated' : 'Created'} product ${id} — visible in this session only.`, 'success', `${editingId ? 'تم تعديل' : 'تم إنشاء'} المنتج ${id} — ظاهر في هذه الجلسة فقط لأن FakeStoreAPI يحاكي الحفظ.`);
  } catch (error) {
    showToast(`Save failed: ${error.message}`, 'error', `تعذّر الحفظ: ${error.message}`);
  }
}

function askBeforeDelete(product) {
  openConfirm(`Delete "${product.title}"? FakeStoreAPI only simulates the write.`, async () => {
    const headers = {};
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    try {
      const removed = await requestJson(`${API_BASE_URL}/products/${product.id}`, { method: 'DELETE', headers });
      const id = Number(product.id);
      state.deletedIds = [...state.deletedIds.filter((item) => Number(item) !== id), id];
      state.products = state.products.filter((item) => !sameProductId(item.id, id));
      state.localProducts = state.localProducts.filter((item) => !sameProductId(item.id, id));
      delete state.editedProducts[id];
      state.favourites = state.favourites.filter((favourite) => Number(favourite) !== id);
      persistLocalState();
      applyLocalFilters();
      render();
      showToast(`Delete accepted for product ${removed?.id ?? id} — removed in this session.`, 'success', `تم حذف المنتج ${removed?.id ?? id} — يختفي في هذه الجلسة فقط.`);
    } catch (error) {
      showToast(`Delete failed: ${error.message}`, 'error', `تعذّر الحذف: ${error.message}`);
    }
  });
}

function setupProductForms() {
  byId('add-product-button').addEventListener('click', () => openProductForm());
  byId('product-form').addEventListener('submit', handleProductSubmit);
  byId('product-form').addEventListener('input', saveDraft);
}

/* --------------------------------------------------------------------------
   12. Scroll progress — only the CSS variable changes; colours stay in CSS.
   -------------------------------------------------------------------------- */
let scrollFrame = 0;

function updateScrollProgress() {
  const root = document.documentElement;
  const max = root.scrollHeight - window.innerHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  root.style.setProperty('--scroll-progress', (0.03 + ratio * 0.97).toFixed(4));
}

function setupScrollProgress() {
  const queue = () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      updateScrollProgress();
    });
  };

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  updateScrollProgress();
}

/* --------------------------------------------------------------------------
   13. Start-up — wire events, then fetch data.
   -------------------------------------------------------------------------- */
function setupEvents() {
  document.addEventListener('close', (event) => {
    if (byId('toast').parentElement === event.target) hideToast();
  }, true);
  byId('product-grid').addEventListener('click', handleProductAction);
  byId('product-table-body').addEventListener('click', handleProductAction);
  setupFilters();
  setupMenu();
  setupSpace();
  setupCart();
  setupAccount();
  setupDialogs();
  setupProductForms();
  setupScrollProgress();
}

function start() {
  restoreState();
  setupTheme();
  setupLanguage();
  setupEvents();
  render();
  loadCatalogue();
}

start();
