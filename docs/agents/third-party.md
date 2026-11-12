# Third-party integrations

Read this before choosing an external service: a payment gateway, a shipping carrier, an email or SMS provider. Choosing one by reading its docs has failed twice here: ZaloPay's sandbox could only be paid through an app that needs a hand-issued test account, and VNPAY's sandbox `querydr` answers `99` to every request (ADR 0009, ADR 0010, `.scratch/m3-mua-hang/issues/16-*`). Each switch rewrote code, ADR, spec and tickets.

## Spike before the ADR

Before writing the ADR that picks a service, run a **tracer bullet** against its sandbox with `/prototype`: a throwaway script that drives one real transaction end to end, using credentials you can get without waiting on anyone.

For a payment gateway, the bullet must reach every path the design depends on:

1. create a payment link and open it;
2. pay with the published test card or account, in a headless browser (Playwright with `E2E_CHANNEL=msedge` works on this machine);
3. read the result on the return URL;
4. call the status-query API for the same transaction;
5. receive the server notification (IPN, webhook, callback), through a tunnel if it needs a public URL.

The spike is done when each path has a recorded outcome: works, broken, or blocked on a human step. A blocked or broken path is a finding for the ADR, not a detail to discover during implementation.

## Record in the ADR

- What the spike exercised, the date, and each path's outcome.
- What the sandbox needs from a human (registration, test accounts, a dashboard setting) and how long it took to get.
- Facts the docs left open and how the spike settled them.

## Credentials

Sandbox keys go in `.env` only; the repo is public. `scripts/check-staged-secrets.ts` runs in the pre-commit hook and blocks a commit containing a `.env` secret.
