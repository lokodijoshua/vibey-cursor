// Central config — single place to update domains.
// Pro payment: Stripe Payment Link (test mode). Flip to the live link at launch.
// Stripe Payment Links collect the customer's email natively — no code needed.
globalThis.VIBEY_CONFIG = {
  BACKEND_URL: 'https://vibey-cursor-backendv2.vercel.app',
  SITE_URL: 'https://vibey-cursor-landing-page.vercel.app',
  STRIPE_PAYMENT_LINK_URL: 'https://buy.stripe.com/test_14A7sKeGg1RxdOI3NsfnO01'
};

// Popup background art. Public asset URL (not a secret) — replace freely.
// Empty string = gradient fallback only.
const POPUP_BACKGROUND_GIF_URL = 'https://res.cloudinary.com/dyzlx6pnt/image/upload/v1791224640/ezgif.com-video-to-gif-converter_pdsvjb.gif';
