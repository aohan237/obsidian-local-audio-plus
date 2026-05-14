import { randomBytes } from "crypto";
import { requestWithProxy } from "../request";
import { buildUrl, getExtension } from "../utils";
import { TranscriptResult, TranscriptSegment, TranscriptionContext, TranscriptionProvider } from "../types";

interface MultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  data: ArrayBuffer;
}

export class OpenAIProvider implements TranscriptionProvider {
  id = "openai" as const;
  name = "OpenAI";

  async transcribe(context: TranscriptionContext): Promise<TranscriptResult> {
    const settings = context.settings.openai;
    if (!settings.apiKey.trim()) {
      throw new Error("OpenAI API key is not configured.");
    }

    if (settings.uploadFormat === "base64") {
      return this.transcribeWithBase64Json(context, settings.transcriptionModel.trim());
    }

    const model = context.settings.enableDiarization
      ? settings.diarizationModel.trim()
      : settings.transcriptionModel.trim();

    const fields: Record<string, string> = {
      model,
      response_format: context.settings.enableDiarization ? "diarized_json" : "json"
    };

    if (context.settings.language.trim()) {
      fields.language = context.settings.language.trim();
    }

    if (context.settings.enableDiarization) {
      fields.chunking_strategy = "auto";
    } else if (settings.prompt.trim()) {
      fields.prompt = settings.prompt.trim();
    }

    const multipart = buildMultipartBody(fields, {
      fieldName: "file",
      filename: context.audioFile.name,
      contentType: mimeTypeForPath(context.audioFile.path),
      data: context.audioData
    });

    const response = await requestWithProxy(context.settings, {
      url: buildUrl(settings.baseUrl, "/audio/transcriptions"),
      method: "POST",
      contentType: multipart.contentType,
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        "Content-Type": multipart.contentType
      },
      body: multipart.body,
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(formatOpenAIError(response.status, response.text));
    }

    const json = parseJson(response.json, response.text);
    return normalizeOpenAIResult(json, model);
  }

  private async transcribeWithBase64Json(context: TranscriptionContext, model: string): Promise<TranscriptResult> {
    const settings = context.settings.openai;
    const submittedModel = normalizeBase64Model(model);
    const body: Record<string, unknown> = {
      model: submittedModel,
      input_audio: {
        data: Buffer.from(context.audioData).toString("base64"),
        format: audioFormatForPath(context.audioFile.path)
      }
    };

    if (context.settings.language.trim()) {
      body.language = context.settings.language.trim();
    }

    if (!context.settings.enableDiarization && settings.prompt.trim()) {
      body.provider = {
        options: {
          openai: {
            prompt: settings.prompt.trim()
          }
        }
      };
    }

    const response = await requestWithProxy(context.settings, {
      url: buildUrl(settings.baseUrl, "/audio/transcriptions"),
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(formatOpenAIError(response.status, response.text));
    }

    const json = parseJson(response.json, response.text);
    return normalizeOpenAIResult(json, submittedModel);
  }
}

function buildMultipartBody(fields: Record<string, string>, file: MultipartFile): { contentType: string; body: ArrayBuffer } {
  const boundary = `----LocalAudioPlus${randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeMultipartName(name)}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="${escapeMultipartName(file.fieldName)}"; filename="${escapeMultipartName(file.filename)}"\r\n`
    )
  );
  chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(Buffer.from(file.data));
  chunks.push(Buffer.from("\r\n"));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(chunks);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  };
}

function normalizeOpenAIResult(json: unknown, model: string): TranscriptResult {
  const value = asRecord(json);
  const text = readString(value.text);
  const segments = normalizeSegments(value.segments);

  return {
    provider: "openai",
    model,
    text: text || segments.map((segment) => segment.text).join("\n"),
    segments,
    raw: json
  };
}

function normalizeSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: TranscriptSegment[] = [];
  value.forEach((item, index) => {
      const record = asRecord(item);
      const text = readString(record.text);
      if (!text) return;
      segments.push({
        speaker: readString(record.speaker) || `Speaker ${index + 1}`,
        text,
        startMs: secondsToMs(record.start),
        endMs: secondsToMs(record.end)
      });
    });
  return segments;
}

function secondsToMs(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  return Math.round(value * 1000);
}

function parseJson(jsonValue: unknown, text: string): unknown {
  if (jsonValue !== undefined && jsonValue !== null) return jsonValue;
  return JSON.parse(text);
}

function formatOpenAIError(status: number, text: string): string {
  const json = safeJson(text);
  const error = asRecord(asRecord(json).error);
  const message = readString(error.message) || text.trim() || "No response body.";
  const details = [
    `OpenAI transcription failed (${status}).`,
    message
  ];

  const type = readString(error.type);
  const param = readString(error.param);
  const code = readString(error.code);
  if (type) details.push(`type: ${type}`);
  if (param) details.push(`param: ${param}`);
  if (code) details.push(`code: ${code}`);

  return details.join("\n");
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

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeBase64Model(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed.includes("/")) return trimmed;
  return `openai/${trimmed}`;
}

function audioFormatForPath(path: string): string {
  const ext = getExtension(path);
  switch (ext) {
    case "mpeg":
    case "mpga":
      return "mp3";
    case "opus":
      return "ogg";
    default:
      return ext || "mp3";
  }
}

function escapeMultipartName(value: string): string {
  return value.replace(/"/g, "%22").replace(/\r|\n/g, " ");
}

function mimeTypeForPath(path: string): string {
  const ext = getExtension(path);
  switch (ext) {
    case "mp3":
    case "mpeg":
    case "mpga":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "mp4":
      return "video/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}
