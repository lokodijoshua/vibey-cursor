// Central server configuration — the single source of truth for every
// business/security number in the backend. Nothing outside this file may
// hardcode these values. Secrets (keys, tokens) stay in environment
// variables and never appear here.
//
// The extension provides the experience. The backend provides the authority.

export const config = {
  // Free tier: controlled capture operations per rolling window.
  FREE_CAPTURE_LIMIT: 20,
  FREE_CAPTURE_WINDOW_MINUTES: 20,

  // Pro tier: marketed as unlimited; these invisible ceilings stop abuse.
  PRO_INTERNAL_CAPTURE_LIMIT: 500, // captures/day/license
  PRO_ENHANCE_LIMIT: 50, // OpenAI enhancements/day/license
  PRO_ENHANCE_MAX_CHARS: 4000, // max prompt length per enhance call

  // Licensing.
  MAX_ACTIVE_ACTIVATIONS: 2, // installations per Pro license

  // Subscription grace: days of continued Pro after a failed payment.
  GRACE_DAYS: 7,

  // Quota responses: how long a client should wait before retrying when the
  // backend itself cannot determine quota (fail-closed path).
  QUOTA_UNAVAILABLE_RETRY_SECONDS: 30,

  // Usage-event retention guidance (days). Cleanup is a scheduled job.
  USAGE_EVENT_RETENTION_DAYS: 30,

  // Behavior analytics ingestion caps (product telemetry, never quota).
  ANALYTICS_MAX_BATCH: 50, // max events accepted per POST
  ANALYTICS_DAILY_CAP: 1000, // max events per installation per rolling 24h
  ANALYTICS_RETENTION_DAYS: 30,
};

// Central feature entitlements per plan. The ONLY place that decides what a
// plan can do. Endpoints return these flags; the extension renders from them.
export const FEATURES = {
  free: {
    prompt_capture: true,
    screenshot_context: false,
    json_context: false,
    figma_export: false,
    history: false,
    ai_enhance: false,
  },
  pro: {
    prompt_capture: true,
    screenshot_context: true,
    json_context: true,
    figma_export: true,
    history: true,
    ai_enhance: true,
  },
};

// The authoritative Pro Price ID lives in the environment, never in code.
// Until STRIPE_PRO_PRICE_ID is configured, price verification is skipped
// (logged) and all other hardening remains fully enforced.
export function getProPriceId() {
  return process.env.STRIPE_PRO_PRICE_ID || null;
}
