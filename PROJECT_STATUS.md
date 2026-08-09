# Project Status

Last verified: 2026-08-09

## Production

- Production URL: `https://shirazstunden.com/`
- Backup URL: `https://shiraz-stunden.am-amanian7.workers.dev/`
- Cloudflare Worker: `shiraz-stunden`
- Production branch: `main`
- Automatic Cloudflare deployment from `main` is enabled.
- Pull-request branches do not deploy to production.
- The apex domain is canonical; HTTP and `www` redirect to HTTPS on the apex.

## Data and integrations

- Cloudflare D1 is the operational database.
- Google Sheets receives manual and scheduled exports.
- Monthly spreadsheets are created in the private Drive folder `shiraz stunde data`.
- Cloudflare KV stores versioned nightly D1 snapshots and change summaries.
- Versioned KV backups older than 30 days are removed automatically.
- PIN authentication, login rate limiting, scan rate limiting, audit logging, and security headers are enabled.

## Reliability controls

- Cloudflare keeps deployment versions available for rollback.
- The nightly cron runs the D1 backup, Google Sheets export, and expired-session cleanup.
- GitHub CI validates type checking, linting, tests, production build, dependency audit, and a Wrangler dry run.
- A scheduled GitHub uptime monitor checks the public site and D1-backed health endpoint every 30 minutes and opens one GitHub issue on failure.
- Dependabot checks npm dependencies weekly and GitHub Actions monthly.

## Validation command

```bash
npm run check
```

No service can be guaranteed to have zero downtime. The current free-tier design uses health monitoring, automatic deployment, rollback versions, and data backups to reduce outage risk and speed recovery.
