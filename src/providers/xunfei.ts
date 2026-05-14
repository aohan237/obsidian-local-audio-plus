import { createHmac, randomBytes } from "crypto";
import { requestWithProxy } from "../request";
import { LocalAudioPlusSettings, XunfeiSettings } from "../config";
import { TranscriptResult, TranscriptSegment, TranscriptionContext, TranscriptionProvider } from "../types";

const DEFAULT_ENDPOINT = "https://office-api-ist-dx.iflyaisol.com";
const UPLOAD_PATH = "/v2/upload";
const GET_RESULT_PATH = "/v2/getResult";

export class XunfeiProvider implements TranscriptionProvider {
  id = "xunfei" as const;
  name = "iFlytek ASR";

  async transcribe(context: TranscriptionContext): Promise<TranscriptResult> {
    const settings = context.settings.xunfei;
    if (!settings.appId.trim() || !settings.apiKey.trim() || !settings.apiSecret.trim()) {
      throw new Error("iFlytek APPID, APIKey, and APISecret are required.");
    }

    const upload = await uploadAudio(context);
    const startedAt = Date.now();

    while (true) {
      const result = await getResult(context.settings, upload.orderId, upload.signatureRandom);
      const code = readCode(result.code);

      if (code === "000000") {
        const content = asRecord(result.content);
        const orderInfo = asRecord(content.orderInfo);
        const status = readNumber(orderInfo.status);

        if (status === 4) {
          return normalizeXunfeiResult(content, result, context.settings.enableDiarization, settings.language);
        }

        if (status === -1) {
          const failType = readString(orderInfo.failType) || String(readNumber(orderInfo.failType) ?? "");
          throw new Error(`iFlytek ASR task failed${failType ? `: failType ${failType}` : ""}.`);
        }
      } else if (code !== "100012" && code !== "100013") {
        throw new Error(`iFlytek getResult failed (${code || "unknown"}): ${readString(result.descInfo)}`);
      }

      if (Date.now() - startedAt > settings.timeoutSeconds * 1000) {
        throw new Error("iFlytek ASR task timed out.");
      }

      await sleep(settings.pollIntervalSeconds * 1000);
    }
  }
}

async function uploadAudio(context: TranscriptionContext): Promise<{ orderId: string; signatureRandom: string }> {
  const settings = context.settings.xunfei;
  const signatureRandom = randomAlphaNumeric(16);
  const params: Record<string, string> = {
    appId: settings.appId.trim(),
    accessKeyId: settings.apiKey.trim(),
    dateTime: formatDateTimeWithOffset(new Date()),
    signatureRandom,
    fileSize: String(context.audioData.byteLength),
    fileName: context.audioFile.name,
    language: settings.language,
    durationCheckDisable: "true"
  };

  if (context.settings.enableDiarization) {
    params.roleType = "1";
    if (context.settings.speakerCount > 0 && context.settings.speakerCount <= 10) {
      params.roleNum = String(context.settings.speakerCount);
    }
  }

  const response = await signedRequest(context.settings, UPLOAD_PATH, params, "application/octet-stream", context.audioData);
  const code = readCode(response.code);
  if (code !== "000000") {
    throw new Error(`iFlytek upload failed (${code || "unknown"}): ${readString(response.descInfo)}`);
  }

  const content = asRecord(response.content);
  const orderId = readString(content.orderId);
  if (!orderId) {
    throw new Error("iFlytek upload response did not include orderId.");
  }

  return { orderId, signatureRandom };
}

async function getResult(
  settings: LocalAudioPlusSettings,
  orderId: string,
  signatureRandom: string
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    accessKeyId: settings.xunfei.apiKey.trim(),
    dateTime: formatDateTimeWithOffset(new Date()),
    signatureRandom,
    orderId,
    resultType: "transfer"
  };

  return signedRequest(settings, GET_RESULT_PATH, params, "application/json", "{}");
}

async function signedRequest(
  settings: LocalAudioPlusSettings,
  path: string,
  params: Record<string, string>,
  contentType: string,
  body: string | ArrayBuffer
): Promise<Record<string, unknown>> {
  const endpoint = normalizeEndpoint(settings.xunfei.endpoint);
  const signature = createSignature(settings.xunfei, params);
  const response = await requestWithProxy(settings, {
    url: `${endpoint}${path}?${buildQuery(params)}`,
    method: "POST",
    contentType,
    headers: {
      "Content-Type": contentType,
      signature
    },
    body,
    throw: false
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`iFlytek request failed (${response.status}): ${response.text}`);
  }

  return parseJson(response.json, response.text);
}

function createSignature(settings: XunfeiSettings, params: Record<string, string>): string {
  return createHmac("sha1", Buffer.from(settings.apiSecret.trim(), "utf8"))
    .update(buildBaseString(params), "utf8")
    .digest("base64");
}

function buildBaseString(params: Record<string, string>): string {
  return sortedParamEntries(params)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${urlEncodeForm(value)}`)
    .join("&");
}

function buildQuery(params: Record<string, string>): string {
  return sortedParamEntries(params)
    .map(([key, value]) => `${key}=${urlEncodeForm(value)}`)
    .join("&");
}

function sortedParamEntries(params: Record<string, string>): [string, string][] {
  return Object.entries(params)
    .filter(([key]) => key !== "signature")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

function urlEncodeForm(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function normalizeEndpoint(value: string): string {
  const raw = value.trim() || DEFAULT_ENDPOINT;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeXunfeiResult(
  content: Record<string, unknown>,
  raw: unknown,
  diarizationEnabled: boolean,
  model: string
): TranscriptResult {
  const parsed = safeJson(readString(content.orderResult));
  const segments = parseLatticeSegments(asRecord(parsed).lattice, diarizationEnabled);
  const text = segments.map((segment) => segment.text).filter(Boolean).join("\n");

  return {
    provider: "xunfei",
    model,
    text,
    segments: diarizationEnabled ? segments : text ? [{ text }] : [],
    raw
  };
}

function parseLatticeSegments(value: unknown, diarizationEnabled: boolean): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];

  const segments: TranscriptSegment[] = [];
  for (const item of value) {
    const jsonBest = safeJson(readString(asRecord(item).json_1best));
    const st = asRecord(asRecord(jsonBest).st);
    const text = extractText(st);
    if (!text.trim()) continue;

    const speakerId = readString(st.rl);
    segments.push({
      speaker: diarizationEnabled && speakerId && speakerId !== "0" ? `Speaker ${speakerId}` : undefined,
      text: text.trim(),
      startMs: readNumber(st.bg),
      endMs: readNumber(st.ed)
    });
  }

  return segments;
}

function extractText(st: Record<string, unknown>): string {
  const words: string[] = [];
  const rt = asArray(st.rt);
  for (const rtItem of rt) {
    const ws = asArray(asRecord(rtItem).ws);
    for (const wsItem of ws) {
      const cw = asArray(asRecord(wsItem).cw);
      const first = asRecord(cw[0]);
      const word = readString(first.w);
      const wordProperty = readString(first.wp);
      if (!word || wordProperty === "g") continue;
      words.push(word);
    }
  }
  return words.join("");
}

function formatDateTimeWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    "T",
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    sign,
    pad2(offsetHours),
    pad2(offsetRemainderMinutes)
  ].join("");
}

function randomAlphaNumeric(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let value = "";
  for (const byte of bytes) {
    value += alphabet[byte % alphabet.length];
  }
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseJson(jsonValue: unknown, text: string): Record<string, unknown> {
  if (jsonValue && typeof jsonValue === "object") return jsonValue as Record<string, unknown>;
  return JSON.parse(text) as Record<string, unknown>;
}

function safeJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readCode(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
