import type { ApiResponse } from '../types/domain';

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string[]>;

  constructor(message: string, status: number, errors?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

const TOKEN_STORAGE_KEY = 'argivit_auth_token';

let currentToken: string | null | undefined;

export function getStoredToken(): string | null {
  if (currentToken !== undefined) return currentToken;
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null, remember = true): void {
  currentToken = token;
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    if (token) {
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // The current tab can still use its in-memory token.
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
  });

  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('Server returned an unreadable response.', res.status);
  }

  if (!res.ok || !body.success) {
    throw new ApiError(
      body.message || `Request failed (${res.status})`,
      res.status,
      body.errors
    );
  }

  return body;
}
