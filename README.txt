River Watch | Task 2 build

Serve this folder over HTTP for local review. Publish index.html, style.css, app.mjs, plan.mjs and history.json together on GitHub Pages. The history file is the stored Task 1 summary.

The Met Éireann warnings and Open-Meteo forecasts are requested fresh on refresh and on each question. The Google Sheet must be readable by the published app. For direct CSV access, set link-viewer permission on the fictional team Sheet and verify the CSV endpoint from the deployed site. To keep the Sheet restricted, use an authorized server-side reader instead.

The page renders its calculated answers independently of the AI relay. In app.mjs set backend to a deployed relay URL with /explain (JSON). The relay must keep the OpenAI key server-side. Request gpt-6-luna with low reasoning effort and return answer, model, input and output. Apply server-side usage limits before making the route public. No credentials belong in this folder.

Current readiness: plan engine verified with synthetic tests. Anonymous Sheet CSV access verified. Deployed AI relay, published-page review and Task 3 screenshots are pending.


Cloudflare relay source is in relay/. Deploy it separately, configure SITE_ORIGIN to the GitHub Pages origin (scheme and hostname only), and set OPENAI_API_KEY as an encrypted Worker secret. Set backend in app.mjs to the deployed Worker origin. The relay uses a persistent, shared 100-call allowance and reserves a call before contacting OpenAI, even if the upstream request fails. The origin check is for browser access and does not authenticate callers. The 100-call allowance protects this relay only. OpenAI account auto-recharge remains a separate check.
