export function validateEnv() {
  const requiredVars = [
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_CLIENT_ID",
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    throw new Error(
      `❌ Missing required environment variables: ${missing.join(", ")}. Please check your .env file.`
    );
  }

  // We don't throw for PUBLISHABLE_KEY right now, but it's good to know.
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    console.warn("⚠️ STRIPE_PUBLISHABLE_KEY is not set.");
  }
}

// Call it immediately upon import so it fails fast during server startup
validateEnv();
