# StorePulse

A responsive online store built from scratch with **plain HTML, CSS and JavaScript**. The visual language comes from `api.html` (bilingual text, CSS variables, commented sections); the functionality follows the front-end fundamentals requirements PDF.

The store reads and writes data through the public [FakeStoreAPI](https://fakestoreapi.com/docs). No build step, framework, package manager or API key is required.

## Run it

From this folder:

```powershell
python -m http.server 8000
```

Then open <http://127.0.0.1:8000/index.html>.

Opening `index.html` directly with `file://` also works for layout, but a local HTTP server is recommended so the Network tab shows requests normally.

## Files

| File | Purpose |
|---|---|
| `index.html` | Semantic structure: one `h1`, header/nav/main/footer landmarks, filters, grid, table, pagination, dialogs and a reusable `<template>`. |
| `style.css` | Design tokens, three themes, responsive breakpoints, focus states, loading animation and reduced-motion support. |
| `script.js` | State, API requests, filtering, debounce, pagination, cart, login, CRUD and storage helpers. |
| `evidence/` | Screenshots named by milestone. Auth values are redacted. |

## Features

- Live catalogue from `GET /products` and `GET /products/categories`.
- Server-side parameters visible in DevTools: category path, `?limit=` and `?sort=`.
- Local search with a hand-written **350 ms debounce** (`setTimeout` + `clearTimeout`).
- Browser-side sorting by price, rating and title.
- Page sizes 5 / 10 / 20; any filter change returns to page 1.
- Grid of cards and a real `<table>` with `caption`, `thead` and `th scope`, sharing the same data and pagination.
- Product detail, edit, delete confirmation, favourites, cart, checkout and login.
- Three switchable themes: **Light**, **Dark** and **Sunrise**.
- English / Arabic / Both switcher inherited from `api.html`; the first visit starts in single-language Arabic (`dir="rtl"`), while **Both** remains available as a learning aid.
- Compact toolbar: search, category, view and clear stay visible; `?sort=`, `?limit=`, page size and browser sort live in an accessible `<details>` panel.
- Loading, error and empty states with retry; clear feedback through a live-region toast.

## Debounce

Typing in the search box does **not** request the API. Each `input` event cancels the previous timer; only the last value is applied after 350 ms:

```js
window.clearTimeout(state.debounceTimer);
state.debounceTimer = window.setTimeout(() => {
  state.filters.search = typed;
  applyLocalFilters();
  render();
}, 350);
```

Verified in the browser: `Search input events: 3; debounced filter runs: 1`. The API request count stayed unchanged while typing, so server parameters and client-side typing have separate jobs.

## Storage map

Small `readJson` / `writeJson` helpers use `JSON.parse`, `JSON.stringify`, `try`/`catch` and safe defaults.

### `localStorage` — survives reload and browser restart

| Key | Value |
|---|---|
| `storepulse_theme` | `light`, `dark` or `sunrise` |
| `storepulse_api_lang` | `both`, `en` or `ar` (from `api.html`) |
| `storepulse_favourites` | Array of product IDs |
| `storepulse_cart` | Array of `{ id, title, price, quantity }` |
| `storepulse_recent_searches` | Last 5 search terms |
| `storepulse_view` | `grid` or `table` |
| `storepulse_page_size` | `5`, `10` or `20` |

### `sessionStorage` — survives reload, dies with the tab

| Key | Value |
|---|---|
| `storepulse_token` | Login token from `POST /auth/login` |
| `storepulse_username` | Logged-in username |
| `storepulse_filters` | Current category, sort, limit, search text and browser sort |
| `storepulse_page` | Current page number |
| `storepulse_product_draft` | Unsent add-product form draft |

### Never stored

Passwords, secret keys, personal data and the full product list. The token is never written to `localStorage`, and all credentials/tokens in `evidence/` are shown as `<redacted>`. Browser storage is still not a secure vault; real applications use HttpOnly cookies and server-side sessions.

## API requests observed in DevTools

| Method | URL / purpose | Status |
|---|---|---|
| GET | `/products/categories` | 304 cached / 200 |
| GET | `/products` | 200 |
| GET | `/products/category/electronics?limit=5&sort=desc` | 304 cached / 200 |
| GET | `/products/1` | 200 |
| PATCH | `/products/1` with Bearer token | 200 |
| DELETE | `/products/1` with Bearer token | 200 |
| POST | `/auth/login` wrong password | 401 plain text |
| POST | `/auth/login` valid demo credentials | 201 with token |
| POST | `/products` with Bearer token | 201 |
| POST | `/carts` with Bearer token | 201 |

FakeStoreAPI only simulates writes; it does not permanently save them. An unknown product id may answer `200` with an empty body, and a wrong password answers `401` with plain text rather than JSON.

## Scaling to 5,000 products

Stress test performed in Chromium by generating 5,000 fake products in the Console and timing `render()` three times with `console.time` / `console.timeEnd`.

| Run | All 5,000 cards rendered | One page of 20 |
|---:|---:|---:|
| 1 | 10,427.2 ms | 283.4 ms |
| 2 | 10,459.1 ms | 304.6 ms |
| 3 | 10,224.5 ms | 284.3 ms |
| **Median** | **10,427.2 ms** | **284.3 ms** |

Rendering one page is about **36.7× faster** than rendering everything at once.

What breaks with everything loaded at once:

- **Download:** one large JSON payload instead of one small page.
- **Memory:** 5,000 product objects plus thousands of DOM nodes and event targets.
- **Rendering:** layout, paint and image decoding for thousands of cards; scrolling and re-renders become expensive.
- **Network:** no way to show a fast first page while the rest is still loading.

A server-side design would request one page per navigation, for example:

```text
GET /products?limit=20&page=3&sort=desc
```

The response would include the 20 products plus a total count (or a `x-total-count` header) so the client knows how many pages exist. The browser then renders only that page, keeps a small loading/error state per request, and caches previous pages when useful. FakeStoreAPI supports `limit` and `sort` but **not** `page`, so this project uses browser-side slicing (`state.products.slice(...)`) after fetching; a real backend with 5,000+ products should page on the server.

## Evidence

| Screenshot | Shows |
|---|---|
| `evidence/M1-overview.png` | Clean load: 10 cards, summary, header, hero and filters. |
| `evidence/M3-responsive-light.png` | 320 / 768 / 1280 px in the light theme. |
| `evidence/M3-responsive-dark.png` | 320 / 768 / 1280 px in the dark theme. |
| `evidence/M3-responsive-sunrise.png` | 320 / 768 / 1280 px in the sunrise theme. |
| `evidence/M5-network-requests.png` | Headers, Payload and Response for every endpoint used. |
| `evidence/M6-stress-test.png` | The three 5,000-product timings and median. |
| `evidence/M6-table-view.png` | Real table view with 10 rows and active view button. |
| `evidence/M7-console-sample.png` | Clean load, debounce proof and timing logs. |
| `evidence/M9-storage.png` | localStorage and sessionStorage maps with token redacted. |

## Testing notes

- **Full suite:** 72 automated checks were repeated 20 times with a fresh tab and empty storage each run: **1440/1440 passed**.
- **Console:** clean on load and throughout the suite, zero uncaught errors. The only console error seen was the expected 401 from the deliberate wrong-password test.
- **Responsive:** no horizontal scroll at 320, 768 or 1280 px in any theme; hamburger appears at ≤768 px and is hidden at 1280 px.
- **Touch targets:** every interactive button/control measured at least 44 px in all three tested widths.
- **Keyboard:** the first focusable element is the skip link; activating it moves focus to `main`; `Tab` reaches search in four steps; typing works; `:focus-visible` outlines are present.
- **Browsers:** automated checks ran in Chromium. A second-browser check was not possible in this environment, so it remains a manual review item.

## What I learned

- Separate **state** from **rendering**: every screen is rebuilt from one `state` object.
- Use the API for server-side parameters, and the browser for instant typing feedback.
- Debounce is about reducing work, not delaying the user unnecessarily.
- Pagination is both a UX feature and a performance boundary.
- Storage location is a design decision: preferences last, sessions do not, secrets do not belong in the browser.
- Semantic HTML plus visible focus states makes keyboard navigation a first-class path.
