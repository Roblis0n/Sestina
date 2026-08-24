# Network, cost, and privacy contract

- Default state is offline and performs zero Provider calls.
- No command discovers credentials, scans ports, probes endpoints, downloads models, follows redirects, retries, or falls back to another Provider.
- A run requires a safe Provider config file with no secret, `--confirm-synthetic-send`, and `--max-cases 1..200`.
- External HTTPS requires an API key explicitly supplied to the run process. Loopback HTTP may omit it.
- Only synthetic benchmark text is eligible for sending. Real project state, private chat, user files, paths, App language, device information, and hidden reasoning are excluded.
- Requests and sanitized predictions may be exported only to paths explicitly selected by the operator. Raw Provider responses and API keys are never persisted.
- `callCount`, latency, and known cost are reported. Unknown cost is `null`.
- A Provider or benchmark failure produces a failure record or an honest blocked result; it does not create semantic-ready evidence.
