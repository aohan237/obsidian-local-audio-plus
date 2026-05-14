import { ProviderId } from "../config";
import { TranscriptionProvider } from "../types";
import { OpenAIProvider } from "./openai";
import { TencentProvider } from "./tencent";

export function createProvider(providerId: ProviderId): TranscriptionProvider {
  switch (providerId) {
    case "openai":
      return new OpenAIProvider();
    case "tencent":
      return new TencentProvider();
    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }
}
