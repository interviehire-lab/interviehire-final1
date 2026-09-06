export interface LegacyGateway { forward(request: Request, legacyPath: string): Promise<Response> }
export function createLegacyGateway(options: { baseUrl: string; internalSecret?: string; fetch?: typeof fetch }): LegacyGateway {
  const send = options.fetch ?? fetch;
  return { async forward(request, legacyPath) {
    const url = new URL(legacyPath + new URL(request.url).search, options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    const headers = new Headers(request.headers); if (options.internalSecret) headers.set("x-internal-secret", options.internalSecret); headers.delete("host");
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    return send(new Request(url, { method: request.method, headers, ...(body ? { body } : {}) }));
  } };
}
