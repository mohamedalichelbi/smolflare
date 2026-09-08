---
"wrangler": patch
---

Keep `wrangler dev` running when a client disconnects during a proxied request

Wrangler no longer treats the transient `Network connection lost` error from one canceled request as a fatal development-session error. It retries an active `GET` or `HEAD` request once. It returns `503` for a failed mutation and does not acknowledge it. Other proxy errors still stop the session and remain visible.
