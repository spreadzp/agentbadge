import type { Hono } from "hono";

export interface HttpResponse {
  status: number;
  body: any;
  headers: Headers;
  text: string;
}

/**
 * HTTP client wrapper for Hono test app.
 * Provides convenient get/post methods with JSON parsing.
 */
export function makeHttpClient(app: Hono) {
  return {
    async get(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
      const res = await app.request(path, { method: "GET", headers });
      return parseResponse(res);
    },

    async post(path: string, body?: any, headers?: Record<string, string>): Promise<HttpResponse> {
      const res = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      return parseResponse(res);
    },

    async put(path: string, body?: any, headers?: Record<string, string>): Promise<HttpResponse> {
      const res = await app.request(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      return parseResponse(res);
    },

    async delete(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
      const res = await app.request(path, { method: "DELETE", headers });
      return parseResponse(res);
    },
  };
}

async function parseResponse(res: Response): Promise<HttpResponse> {
  const text = await res.text();
  let body: any = text;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      // Keep text body if JSON parse fails
    }
  }
  return {
    status: res.status,
    body,
    headers: res.headers,
    text,
  };
}
