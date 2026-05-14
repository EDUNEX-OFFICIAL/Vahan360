const isProd = process.env.NODE_ENV === "production";
const MIN_LENGTH = 32;

const DEV_FALLBACK = "TaK+HaV^uvCHEFsEVfypW#7g9^k*Z8$V";

/** Known weak / placeholder values */
function isPlaceholder(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return (
    v === "change-me-in-production" ||
    v === "changeme" ||
    v === "secret" ||
    v === "your_jwt_secret_key_here_change_to_strong_random_min32_chars" ||
    /^change-it$/i.test(v)
  );
}

function resolveJwtSecret() {
  const trimmed = process.env.JWT_SECRET != null ? String(process.env.JWT_SECRET).trim() : "";

  if (trimmed && isPlaceholder(trimmed)) {
    if (isProd) {
      throw new Error(
        "[jwt] JWT_SECRET must not be a placeholder in production. Generate with:\n" +
          "  openssl rand -base64 48"
      );
    }
    console.warn("[jwt] JWT_SECRET is a placeholder — using dev-only fallback.");
    return DEV_FALLBACK;
  }

  if (trimmed.length >= MIN_LENGTH) {
    return trimmed;
  }

  if (isProd) {
    if (!trimmed) {
      throw new Error(
        "[jwt] JWT_SECRET is required in production (min " +
          MIN_LENGTH +
          " characters). Generate with:\n" +
          "  openssl rand -base64 48\n" +
          "Rotating JWT_SECRET invalidates existing tokens — users must sign in again."
      );
    }
    throw new Error(
      `[jwt] JWT_SECRET must be at least ${MIN_LENGTH} characters in production (got ${trimmed.length}).`
    );
  }

  if (trimmed.length > 0 && trimmed.length < MIN_LENGTH) {
    console.warn(
      `[jwt] JWT_SECRET is shorter than ${MIN_LENGTH} chars — OK for local dev only.`
    );
    return trimmed;
  }

  console.warn(
    "[jwt] JWT_SECRET not set — using development-only fallback. Set JWT_SECRET before production deploy."
  );
  return DEV_FALLBACK;
}

const JWT_SECRET = resolveJwtSecret();

module.exports = { JWT_SECRET, MIN_LENGTH };
