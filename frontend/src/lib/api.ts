const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token: string;
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | undefined | null>;
}

export async function apiRequest<TResponse = unknown>(
  path: string,
  { method = 'GET', token, body, signal, query }: RequestOptions
): Promise<TResponse> {
  const url = new URL(API_BASE_URL ? `${API_BASE_URL}${path}` : path, window.location.origin);

  if (query) {
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  }

  const response = await fetch(url.toString(), {
    method,
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API request failed (${response.status} ${response.statusText})${
        errorBody ? `: ${errorBody}` : ''
      }`
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}
