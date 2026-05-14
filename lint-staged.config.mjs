export default {
  'apps/web/**/*.{ts,tsx}': (files) =>
    files.length > 0
      ? `pnpm --filter @vahan360/web exec eslint --fix --max-warnings 0 ${files.map((f) => JSON.stringify(f)).join(' ')}`
      : [],
  'apps/api-nest/**/*.ts': () =>
    'pnpm --filter @vahan360/api-nest exec tsc -p tsconfig.json --noEmit',
  'packages/contracts/**/*.ts': () =>
    'pnpm --filter @vahan360/contracts exec tsc -p tsconfig.json --noEmit',
  'packages/scraper-core/**/*.ts': () =>
    'pnpm --filter @vahan360/scraper-core exec tsc -p tsconfig.json --noEmit',
};
