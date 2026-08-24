// Admin token entered once, kept in localStorage with a warning (§17.4).
// This is a dev-console credential store, not a production secrets vault —
// document that honestly rather than pretending otherwise.
const STORAGE_KEY = "turnstile_admin_token";

export function getAdminToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
