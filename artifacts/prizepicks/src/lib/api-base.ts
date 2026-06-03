/** Normalized app base path (respects Vite `BASE_PATH` / Replit artifact routing). */
export function apiBase(): string {
  return (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
}

/** Build an absolute API path under the app base, e.g. `/api/slate`. */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
}
