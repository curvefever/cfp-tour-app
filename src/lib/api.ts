function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isTestHost(hostname: string): boolean {
  return hostname === "test.curvefever.pro" || hostname.endsWith("-test.curvefever.pro");
}

function buildEndpointURL(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) return endpoint;
  if (endpoint.includes("localhost") || endpoint.includes("127.0.0.1")) return `http://${endpoint}`;
  return `https://${endpoint}`;
}

export function getApiBaseURL(hostname?: string): string {
  const configuredEndpoint = import.meta.env.VITE_API_ENDPOINT?.trim();
  if (configuredEndpoint) return buildEndpointURL(configuredEndpoint);
  if (hostname && isLocalHost(hostname)) return "http://localhost:8000";
  if (hostname && isTestHost(hostname)) return "https://api-test.curvefever.pro";
  return "https://api.curvefever.pro";
}

/** A refusal from the API, with the API's own numeric code (e.g. 700 for a token it no longer accepts). */
export class ApiError extends Error {
  readonly code: number | undefined;
  readonly status: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = {
  code?: unknown;
  data?: { code?: unknown; message?: string };
  message?: string;
};

function errorCode(body: ErrorBody | null): number | undefined {
  const code = body?.code ?? body?.data?.code;
  return typeof code === "number" ? code : undefined;
}

export async function postJSON<TResponse>(
  path: string,
  payload: object,
  options?: { hostname?: string },
): Promise<TResponse> {
  const response = await fetch(`${getApiBaseURL(options?.hostname)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responseBody = (await response.json().catch(() => null)) as ErrorBody | null;
  if (!response.ok) {
    const message = responseBody?.data?.message || responseBody?.message || "Unable to complete the request.";
    throw new ApiError(message, response.status, errorCode(responseBody));
  }
  return responseBody as TResponse;
}
