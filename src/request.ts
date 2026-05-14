import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { LocalAudioPlusSettings } from "./config";

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks5h:"]);

export async function requestWithProxy(
  settings: LocalAudioPlusSettings,
  request: RequestUrlParam
): Promise<RequestUrlResponse> {
  if (!settings.proxy.enabled || !settings.proxy.url.trim()) {
    return requestUrl(request);
  }

  return nodeRequest(request, normalizeProxyUrl(settings.proxy.url));
}

function nodeRequest(request: RequestUrlParam, proxyUrl: string): Promise<RequestUrlResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(request.url);
    const proxy = new URL(proxyUrl);
    const requestBody = request.body === undefined ? undefined : bodyToBuffer(request.body);
    const headers = normalizeHeaders(request.headers ?? {});

    if (request.contentType && !hasHeader(headers, "content-type")) {
      headers["Content-Type"] = request.contentType;
    }

    if (requestBody && !hasHeader(headers, "content-length")) {
      headers["Content-Length"] = String(requestBody.byteLength);
    }

    const send = target.protocol === "http:" ? httpRequest : httpsRequest;
    const clientRequest = send(
      target,
      {
        method: request.method ?? "GET",
        headers,
        agent: createProxyAgent(proxy, target.protocol) as never
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString("utf8");
          const result: RequestUrlResponse = {
            status: response.statusCode ?? 0,
            headers: responseHeadersToRecord(response.headers),
            arrayBuffer: bufferToArrayBuffer(buffer),
            json: safeJson(text),
            text
          };

          if (request.throw !== false && result.status >= 400) {
            reject(new Error(`Request failed (${result.status}): ${text}`));
          } else {
            resolve(result);
          }
        });
      }
    );

    clientRequest.on("error", reject);
    if (requestBody) {
      clientRequest.write(requestBody);
    }
    clientRequest.end();
  });
}

function normalizeProxyUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error("Proxy URL must use http://, https://, socks5://, or socks5h://.");
  }
  return url.toString();
}

function createProxyAgent(proxy: URL, targetProtocol: string): HttpProxyAgent<string> | HttpsProxyAgent<string> | SocksProxyAgent {
  if (proxy.protocol === "socks5:" || proxy.protocol === "socks5h:") {
    return new SocksProxyAgent(proxy);
  }
  if (targetProtocol === "http:") {
    return new HttpProxyAgent(proxy);
  }
  return new HttpsProxyAgent(proxy);
}

function bodyToBuffer(body: string | ArrayBuffer): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = value;
  }
  return normalized;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
}

function responseHeadersToRecord(headers: Record<string, string | string[] | number | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.join(", ");
    } else if (value !== undefined) {
      result[key] = String(value);
    }
  }
  return result;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function safeJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
