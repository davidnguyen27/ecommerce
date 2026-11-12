# Local walkthrough

Read this before driving the real app on this machine: placing an order, logging into admin, trying a payment.

## Data and accounts

- `node scripts/demo-seed.ts` fills an empty local DB with pages, legal info, brands, published products and the default shipping fee, and prints the admin login. On a DB that already has demo data it only adds what is missing (the shipping fee) and prints the login.
- Admin login: the `OWNER` constant at the top of `scripts/demo-seed.ts`. Write through the admin API rather than SQL, so changes go through `audited()`.
- Without a default shipping fee the cart shows "Cửa hàng chưa sẵn sàng nhận đơn": that is ticket 01's intended behaviour, fixed by the seed above.

## Orders placed by a script

- The order lookup token is stored only as a hash. To reopen an order later, capture the body of `POST /api/checkout` with Playwright `page.route` (the page navigates to the gateway immediately, so a `response` listener loses the body).
- The result page (`/don-hang/<code>?ket-qua=1`) reads the token from the sessionStorage of the tab that placed the order; another browser shows "không còn thông tin để mở đơn".

## Payment gateway

- `.env` with VNPAY keys runs VNPAY sandbox; empty keys run the simulator (`/thanh-toan-gia-lap`). See `docs/vnpay.md` for test cards.

## Docker on this Windows machine

- Docker Compose v5.6 build fails with `additional privileges requested`; run `BUILDX_BAKE_ENTITLEMENTS_FS=0 docker compose up -d --build`.
- A test failing with `Connection terminated due to connection timeout`, or a lone timeout right after Docker starts, is Docker Desktop: rerun that file alone. CI on Linux is the reference.
