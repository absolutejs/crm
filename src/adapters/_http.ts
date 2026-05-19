export type CRMHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type CRMHttpResponse<T = unknown> = {
  status: number;
  ok: boolean;
  data: T;
  headers?: Record<string, string>;
};

export type CRMHttpRequest = {
  method: CRMHttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type CRMHttpClient = <T = unknown>(
  request: CRMHttpRequest,
) => Promise<CRMHttpResponse<T>>;

export const createFetchCRMHttpClient = (): CRMHttpClient =>
  async <T = unknown>(request: CRMHttpRequest): Promise<CRMHttpResponse<T>> => {
    const init: RequestInit = {
      headers: request.headers,
      method: request.method,
    };
    if (request.body !== undefined && request.body !== null) {
      if (request.body instanceof URLSearchParams || typeof request.body === "string") {
        init.body = request.body;
      } else {
        init.body = JSON.stringify(request.body);
        init.headers = {
          "Content-Type": "application/json",
          ...request.headers,
        };
      }
    }
    const response = await fetch(request.url, init);
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      data: parsed as T,
      ok: response.ok,
      status: response.status,
    };
  };

export class CRMHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "CRMHttpError";
  }
}

export const assertHttpOk = <T>(
  response: CRMHttpResponse<T>,
  context: string,
): T => {
  if (!response.ok) {
    throw new CRMHttpError(
      `${context} failed: HTTP ${response.status}`,
      response.status,
      response.data,
    );
  }
  return response.data;
};
