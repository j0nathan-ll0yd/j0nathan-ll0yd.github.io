const TOKEN_KEY = 'portal_api_token';
const API_URL_KEY = 'portal_api_url';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getApiUrl(): string | null {
  return localStorage.getItem(API_URL_KEY);
}

export function setApiUrl(url: string): void {
  localStorage.setItem(API_URL_KEY, url);
}

export function isAuthenticated(): boolean {
  return !!getToken() && !!getApiUrl();
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(API_URL_KEY);
}

export function promptForAuth(): boolean {
  const url = prompt('API Base URL (e.g. https://xxx.execute-api.us-east-1.amazonaws.com/prod/api):');
  if (!url) return false;
  const token = prompt('Bearer Token:');
  if (!token) return false;
  setApiUrl(url.replace(/\/$/, ''));
  setToken(token);
  return true;
}
