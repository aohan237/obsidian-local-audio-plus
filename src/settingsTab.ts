import { App, PluginSettingTab, Setting } from "obsidian";
import { OPENAI_TRANSCRIPTION_MODELS } from "./config";
import { openAITranscriptionModelName, t } from "./i18n";
import type LocalAudioPlusPlugin from "./main";

export class LocalAudioPlusSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: LocalAudioPlusPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t("settings.title")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.provider.name"))
      .setDesc(t("settings.provider.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai", t("settings.provider.openai"))
          .addOption("tencent", t("settings.provider.tencent"))
          .addOption("xunfei", t("settings.provider.xunfei"))
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as typeof this.plugin.settings.provider;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.automaticProcessing.name"))
      .setDesc(t("settings.automaticProcessing.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.automaticProcessing)
          .onChange(async (value) => {
            this.plugin.settings.automaticProcessing = value;
            await this.plugin.saveSettings();
            this.plugin.setupQueueInterval();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.processingInterval.name"))
      .setDesc(t("settings.processingInterval.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.processingIntervalSeconds))
          .onChange(async (value) => {
            const parsed = parsePositiveInteger(value, 5, 3600);
            if (parsed === null) return;
            this.plugin.settings.processingIntervalSeconds = parsed;
            await this.plugin.saveSettings();
            this.plugin.setupQueueInterval();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.showNotifications.name"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNotifications)
          .onChange(async (value) => {
            this.plugin.settings.showNotifications = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.enabledExtensions.name"))
      .setDesc(t("settings.enabledExtensions.desc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.enabledExtensions)
          .onChange(async (value) => {
            this.plugin.settings.enabledExtensions = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.excludedFolders.name"))
      .setDesc(t("settings.excludedFolders.desc"))
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.excludedFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.optional"))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.speakerDiarization.name"))
      .setDesc(t("settings.speakerDiarization.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableDiarization)
          .onChange(async (value) => {
            this.plugin.settings.enableDiarization = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.speakerCount.name"))
      .setDesc(t("settings.speakerCount.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.speakerCount))
          .onChange(async (value) => {
            const parsed = parseInteger(value, 0, 100);
            if (parsed === null) return;
            this.plugin.settings.speakerCount = parsed;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.replaceExisting.name"))
      .setDesc(t("settings.replaceExisting.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.replaceExistingTranscripts)
          .onChange(async (value) => {
            this.plugin.settings.replaceExistingTranscripts = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.transcriptFormatting.name"))
      .setDesc(t("settings.transcriptFormatting.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("autoParagraphs", t("settings.transcriptFormatting.autoParagraphs"))
          .addOption("plain", t("settings.transcriptFormatting.plain"))
          .setValue(this.plugin.settings.transcriptFormatting)
          .onChange(async (value) => {
            this.plugin.settings.transcriptFormatting = value as typeof this.plugin.settings.transcriptFormatting;
            await this.plugin.saveSettings();
          })
      );

    this.displayProxySettings(containerEl);
    this.displayOpenAISettings(containerEl);
    this.displayTencentSettings(containerEl);
    this.displayXunfeiSettings(containerEl);
  }

  private displayProxySettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.proxy.title")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.proxy.enabled.name"))
      .setDesc(t("settings.proxy.enabled.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.proxy.enabled)
          .onChange(async (value) => {
            this.plugin.settings.proxy.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.proxy.url.name"))
      .setDesc(t("settings.proxy.url.desc"))
      .addText((text) =>
        text
          .setPlaceholder("socks5h://127.0.0.1:1080")
          .setValue(this.plugin.settings.proxy.url)
          .onChange(async (value) => {
            this.plugin.settings.proxy.url = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private displayOpenAISettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("OpenAI").setHeading();

    new Setting(containerEl)
      .setName(t("settings.openai.apiKey.name"))
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openai.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.openai.apiKey = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.openai.baseUrl.name"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.openai.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.openai.baseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.openai.uploadFormat.name"))
      .setDesc(t("settings.openai.uploadFormat.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("base64", t("settings.openai.uploadFormat.base64"))
          .addOption("formData", t("settings.openai.uploadFormat.formData"))
          .setValue(this.plugin.settings.openai.uploadFormat)
          .onChange(async (value) => {
            this.plugin.settings.openai.uploadFormat = value as typeof this.plugin.settings.openai.uploadFormat;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.openai.transcriptionModel.name"))
      .setDesc(t("settings.openai.transcriptionModel.desc"))
      .addDropdown((dropdown) => {
        const modelIds = new Set(OPENAI_TRANSCRIPTION_MODELS.map((model) => model.id));
        for (const model of OPENAI_TRANSCRIPTION_MODELS) {
          dropdown.addOption(model.id, openAITranscriptionModelName(model.id) ?? model.name);
        }
        if (this.plugin.settings.openai.transcriptionModel && !modelIds.has(this.plugin.settings.openai.transcriptionModel)) {
          dropdown.addOption(
            this.plugin.settings.openai.transcriptionModel,
            `${t("settings.customPrefix")}: ${this.plugin.settings.openai.transcriptionModel}`
          );
        }
        dropdown
          .setValue(this.plugin.settings.openai.transcriptionModel)
          .onChange(async (value) => {
            this.plugin.settings.openai.transcriptionModel = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.openai.diarizationModel.name"))
      .setDesc(t("settings.openai.diarizationModel.desc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.openai.diarizationModel)
          .onChange(async (value) => {
            this.plugin.settings.openai.diarizationModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.openai.prompt.name"))
      .setDesc(t("settings.openai.prompt.desc"))
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.openai.prompt)
          .onChange(async (value) => {
            this.plugin.settings.openai.prompt = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private displayTencentSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.tencent.title")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.tencent.secretId.name"))
      .setDesc(t("settings.tencent.secretId.desc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.tencent.secretId)
          .onChange(async (value) => {
            this.plugin.settings.tencent.secretId = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.secretKey.name"))
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setValue(this.plugin.settings.tencent.secretKey)
          .onChange(async (value) => {
            this.plugin.settings.tencent.secretKey = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.tencent.endpoint.name"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.tencent.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.tencent.endpoint = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.region.name"))
      .setDesc(t("settings.tencent.region.desc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.tencent.region)
          .onChange(async (value) => {
            this.plugin.settings.tencent.region = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.engineModel.name"))
      .setDesc(t("settings.tencent.engineModel.desc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.tencent.engineModelType)
          .onChange(async (value) => {
            this.plugin.settings.tencent.engineModelType = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.channelNum.name"))
      .setDesc(t("settings.tencent.channelNum.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tencent.channelNum))
          .onChange(async (value) => {
            const parsed = parseInteger(value, 1, 2);
            if (parsed === null) return;
            this.plugin.settings.tencent.channelNum = parsed;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.resultTextFormat.name"))
      .setDesc(t("settings.tencent.resultTextFormat.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tencent.resTextFormat))
          .onChange(async (value) => {
            const parsed = parseInteger(value, 0, 5);
            if (parsed === null) return;
            this.plugin.settings.tencent.resTextFormat = parsed;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.hotwordList.name"))
      .setDesc(t("settings.tencent.hotwordList.desc"))
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.tencent.hotwordList)
          .onChange(async (value) => {
            this.plugin.settings.tencent.hotwordList = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.pollInterval.name"))
      .setDesc(t("settings.tencent.pollInterval.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tencent.pollIntervalSeconds))
          .onChange(async (value) => {
            const parsed = parsePositiveInteger(value, 3, 3600);
            if (parsed === null) return;
            this.plugin.settings.tencent.pollIntervalSeconds = parsed;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tencent.timeout.name"))
      .setDesc(t("settings.tencent.timeout.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.tencent.timeoutSeconds))
          .onChange(async (value) => {
            const parsed = parsePositiveInteger(value, 30, 21600);
            if (parsed === null) return;
            this.plugin.settings.tencent.timeoutSeconds = parsed;
            await this.plugin.saveSettings();
          })
      );
  }

  private displayXunfeiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.xunfei.title")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.xunfei.appId.name"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.xunfei.appId)
          .onChange(async (value) => {
            this.plugin.settings.xunfei.appId = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.xunfei.apiKey.name"))
      .setDesc(t("settings.xunfei.apiKey.desc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.xunfei.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.xunfei.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.xunfei.apiSecret.name"))
      .setDesc(t("settings.xunfei.apiSecret.desc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setValue(this.plugin.settings.xunfei.apiSecret)
          .onChange(async (value) => {
            this.plugin.settings.xunfei.apiSecret = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.xunfei.endpoint.name"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.xunfei.endpoint)
          .onChange(async (value) => {
            this.plugin.settings.xunfei.endpoint = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.xunfei.language.name"))
      .setDesc(t("settings.xunfei.language.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("autodialect", t("settings.xunfei.language.autodialect"))
          .addOption("autominor", t("settings.xunfei.language.autominor"))
          .setValue(this.plugin.settings.xunfei.language)
          .onChange(async (value) => {
            this.plugin.settings.xunfei.language = value as typeof this.plugin.settings.xunfei.language;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.xunfei.pollInterval.name"))
      .setDesc(t("settings.xunfei.pollInterval.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.xunfei.pollIntervalSeconds))
          .onChange(async (value) => {
            const parsed = parsePositiveInteger(value, 3, 3600);
            if (parsed === null) return;
            this.plugin.settings.xunfei.pollIntervalSeconds = parsed;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.xunfei.timeout.name"))
      .setDesc(t("settings.xunfei.timeout.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.xunfei.timeoutSeconds))
          .onChange(async (value) => {
            const parsed = parsePositiveInteger(value, 30, 21600);
            if (parsed === null) return;
            this.plugin.settings.xunfei.timeoutSeconds = parsed;
            await this.plugin.saveSettings();
          })
      );
  }
}

function parsePositiveInteger(value: string, min: number, max: number): number | null {
  return parseInteger(value, min, max);
}

function parseInteger(value: string, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}
