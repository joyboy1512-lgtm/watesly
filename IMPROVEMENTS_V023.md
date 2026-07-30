# MyWat v0.23 Improvements

## Implemented without external providers
- Redesigned login experience and design tokens.
- Stronger Inbox: responsive three-panel layout, mobile navigation, search/filter UX, retries, skeletons, empty states, auto-scroll, file-size validation, keyboard sending, character limit and clear status/priority indicators.
- Global toast notifications and React error boundary.
- Safer concurrent refresh-token handling and per-request correlation IDs.
- Additional API security headers, no-store auth responses and structured request timing logs.
- ADR documentation for modular architecture, outbox reliability and privacy.

## Still requires external setup
- Real Meta account and webhook verification.
- Production domain/TLS and hardened CSP for the final frontend origin.
- Payment-provider credentials.
- Real load testing and production monitoring provider.
