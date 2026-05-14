import { ProviderId } from "../config";
import { TranscriptionProvider } from "../types";
import { OpenAIProvider } from "./openai";
import { TencentProvider } from "./tencent";
import { XunfeiProvider } from "./xunfei";

export function createProvider(providerId: ProviderId): TranscriptionProvider {
  switch (providerId) {
    case "openai":
      return new OpenAIProvider();
    case "tencent":
      return new TencentProvider();
    case "xunfei":
      return new XunfeiProvider();
    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}
