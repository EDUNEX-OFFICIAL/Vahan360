const isProd = process.env.NODE_ENV === 'production';
const MIN_LENGTH = 32;
const DEV_FALLBACK = 'TaK+HaV^uvCHEFsEVfypW#7g9^k*Z8$V';

function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return (
    v === 'change-me-in-production' ||
    v === 'changeme' ||
    v === 'secret' ||
    v === 'your_jwt_secret_key_here_change_to_strong_random_min32_chars' ||
    /^change-it$/i.test(v)
  );
}

/** Mirrors `apps/api-express/src/config/jwtSecret.js` so Nest verifies the same access tokens. */
export function resolveNestJwtSecret(): string {
  const trimmed =
    process.env.JWT_SECRET != null ? String(process.env.JWT_SECRET).trim() : '';

  if (trimmed && isPlaceholder(trimmed)) {
    if (isProd) {
      throw new Error(
        '[jwt] JWT_SECRET must not be a placeholder in production. Generate with: openssl rand -base64 48',
      );
    }
    return DEV_FALLBACK;
  }

  if (trimmed.length >= MIN_LENGTH) {
    return trimmed;
  }

  if (isProd) {
    if (!trimmed) {
      throw new Error(
        `[jwt] JWT_SECRET is required in production (min ${MIN_LENGTH} characters).`,
      );
    }
    throw new Error(
      `[jwt] JWT_SECRET must be at least ${MIN_LENGTH} characters in production (got ${trimmed.length}).`,
    );
  }

  if (trimmed.length > 0 && trimmed.length < MIN_LENGTH) {
    return trimmed;
  }

  return DEV_FALLBACK;
}
