/** Cliente HTTP do aplicativo: sessão por cookie HttpOnly, cabeçalho próprio nas mutações e erros com identificador de correlação. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId: string | null,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const raw = body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'office3d', ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique a rede e tente de novo.', null, {});
  }
  const text = await res.text();
  let data: Json = {};
  try {
    data = text ? (JSON.parse(text) as Json) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : `Erro ${res.status}`;
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'error', msg, (data.correlationId as string) ?? res.headers.get('x-correlation-id'), data);
  }
  return data as T;
}

export const api = {
  get: <T = Json>(url: string) => request<T>('GET', url),
  post: <T = Json>(url: string, body: unknown = {}, headers?: Record<string, string>) => request<T>('POST', url, body, headers),
  put: <T = Json>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  patch: <T = Json>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  raw: <T = Json>(url: string, body: Blob | Uint8Array, headers: Record<string, string>) => request<T>('POST', url, body, headers),
};

/** Chave de idempotência gerada uma vez por intenção do usuário (não por clique). */
export const idempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const errorText = (e: unknown) => {
  if (e instanceof ApiError) return e.correlationId ? `${e.message} (ref. ${e.correlationId.slice(0, 8)})` : e.message;
  return (e as Error)?.message ?? 'Erro inesperado.';
};
