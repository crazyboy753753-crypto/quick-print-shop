# Quick Print Shop

Online version of the Quick Print Shop app: customers send print orders from their phone,
you run the whole shop from the dashboard.

* **Customers** open the site, upload their files, choose the print type, pages and copies,
  see the price and send the order. No login needed.
* **You** open `/owner`, enter your PIN and see every order with the file ready to download,
  plus billing, stock, rates, udhar and the credit score — the same dashboard as the app.

The shop logic (billing, stock, udhar, print rates) is the exact same code that runs inside
the Android app, so both stay in sync.

## Run it locally

```bash
npm install
npm start
```

* Customer page: http://localhost:3000
* Owner dashboard: http://localhost:3000/owner — default PIN `1234`

Data is stored in `./data` (a JSON file plus the uploaded files). Set `DATA_DIR` to move it.

## Deploy on Render

1. Push this repo to GitHub.
2. Render dashboard → **New** → **Blueprint** → pick the repo (it reads `render.yaml`).
   Or **New** → **Web Service** and fill in by hand:
   * Build command: `npm install`
   * Start command: `npm start`
   * Health check path: `/api/config`
3. Environment variables:
   * `OWNER_PIN` — your dashboard PIN (change it from the default `1234`)
   * `DATA_DIR` — `/var/data`
   * `NODE_VERSION` — `20.20.2`
4. Add a **Disk**: name `quick-print-data`, mount path `/var/data`, 1 GB.
   Without a disk, every restart wipes orders and bills (the free plan cannot attach one).

After the first deploy you get a URL like `https://quick-print-shop.onrender.com`:

* share `https://…onrender.com` with customers
* open `https://…onrender.com/owner` for yourself

## What lives where

| Path | What |
| --- | --- |
| `/` | customer order page |
| `/owner` | owner dashboard (PIN) |
| `/api/config` | public shop details and rates |
| `/api/orders` | customer order with file upload |
| `/api/owner/*` | dashboard API (needs the PIN session) |
| `/api/owner/files/:order/:file` | download an uploaded file |

## Customer side

* Customers send a file and immediately get a **live status page** (Received → Printing → Ready → Collected)
  that refreshes by itself, plus the **bill number and total** once the shop marks the order ready.
* They can come back later: order number + mobile number shows the same status.
* The dashboard has a **Customer QR** card in Settings — print it and put it at the counter.

## Notes

* Uploads: PDF, JPG, PNG, WEBP, Word, Excel, PowerPoint, TXT — 20 files, 25 MB each.
* The dashboard session lasts 12 hours; the cookie is HttpOnly.
* Backups: Settings → *Bills CSV* / *Stock CSV*, or copy the `DATA_DIR` folder.
* Changing the PIN: Settings → *Change PIN*.

## Tests

```bash
node test/smoke.js
```

Covers: page load, PIN login, customer upload, order in the dashboard, file download
(with and without login), status flow with automatic bill, billing, stock and udhar.
