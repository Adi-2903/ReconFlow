/**
 * Environment validation — Vercel-safe version.
 *
 * Only DATABASE_URL is a hard requirement because every route depends on the DB.
 * Connector keys (Stripe, QBO) are optional — the app should boot fine without
 * them and individual connector routes will fail gracefully at call time.
 */
export function validateEnv() {
  // Hard requirements — app cannot function without these
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "❌ Missing required environment variable: DATABASE_URL. Please check your .env file or Vercel environment settings."
    );
  }

  // Soft warnings — optional connector integrations
  const optionalVars = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
    "GEMINI_API_KEY",
  ];

  const missing = optionalVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.warn(
      `⚠️ Optional environment variables not set: ${missing.join(", ")}. Related features (Stripe, QBO, AI reasoning) will be unavailable.`
    );
  }
}

// Call it immediately upon import so it fails fast during server startup
validateEnv();
