import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { APP_TITLE, DEFAULT_SETTINGS, LocalAudioPlusSettings } from "./config";
import { formatTranscriptBlock } from "./formatter";
import { createProvider } from "./providers";
import { LocalAudioPlusSettingTab } from "./settingsTab";
import { AudioLinkMatch } from "./types";
import { UniqueQueue } from "./uniqueQueue";
import {
  cleanLinkTarget,
  extensionSet,
  findAudioLinks,
  findTranscriptBlock,
  getExtension,
  isExcluded,
  notify,
  resolveVaultAudioFile,
  sha256Hex
} from "./utils";

export default class LocalAudioPlusPlugin extends Plugin {
  settings!: LocalAudioPlusSettings;
  private modifiedQueue = new UniqueQueue<TFile>();
  private intervalId = 0;
  private processingFiles = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("file-audio", APP_TITLE, () => {
      void this.processActiveNote();
    });

    this.addCommand({
      id: "transcribe-current-note",
      name: "Transcribe local audio in current note",
      callback: () => {
        void this.processActiveNote();
      }
    });

    this.addCommand({
      id: "transcribe-all-notes",
      name: "Transcribe local audio in all notes",
      callback: () => {
        void this.processAllNotes();
      }
    });

    this.addCommand({
      id: "diagnose-current-note",
      name: "Diagnose local audio in current note",
      callback: () => {
        void this.diagnoseActiveNote();
      }
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.settings.automaticProcessing || !(file instanceof TFile) || file.extension !== "md") return;
        if (this.processingFiles.has(file.path)) return;
        if (this.isPathExcluded(file)) return;
        this.modifiedQueue.push(file, 1);
      })
    );

    this.setupQueueInterval();
    this.addSettingTab(new LocalAudioPlusSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = 0;
    }
  }

  setupQueueInterval(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = 0;
    }

    if (this.settings.automaticProcessing && this.settings.processingIntervalSeconds > 0) {
      this.intervalId = window.setInterval(
        () => void this.processModifiedQueue(),
        this.settings.processingIntervalSeconds * 1000
      );
      this.registerInterval(this.intervalId);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async processActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) {
      notify("Open a markdown note first.", this.settings.showNotifications, 10000);
      return;
    }
    await this.processNote(file);
  }

  private async diagnoseActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) {
      notify("Open a markdown note first.", this.settings.showNotifications, 10000);
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const report = this.collectAudioTargets(file, content);
    notify(
      [
        `Scanned ${report.totalLinks} markdown/wiki link(s).`,
        `Found ${report.targets.length} supported local audio file(s).`,
        report.unsupportedCount ? `Skipped ${report.unsupportedCount} unsupported/non-local link(s).` : "",
        report.existingTranscriptCount ? `Found ${report.existingTranscriptCount} existing transcript block(s).` : "",
        `Provider: ${this.settings.provider}`
      ]
        .filter(Boolean)
        .join("\n"),
      this.settings.showNotifications,
      15000
    );
  }

  private async processAllNotes(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isPathExcluded(file));
    const notice = this.settings.showNotifications
      ? new Notice(`${APP_TITLE}\nProcessing ${files.length} notes...`, 0)
      : null;

    try {
      for (const [index, file] of files.entries()) {
        notice?.setMessage(`${APP_TITLE}\nProcessing ${index + 1}/${files.length}: ${file.path}`);
        await this.processNote(file, false);
      }
      notice?.setMessage(`${APP_TITLE}\nFinished processing ${files.length} notes.`);
    } finally {
      if (notice) {
        window.setTimeout(() => notice.hide(), 5000);
      }
    }
  }

  private async processModifiedQueue(): Promise<void> {
    const iteration = this.modifiedQueue.iterationQueue();
    for (const file of iteration) {
      await this.processNote(file, false);
    }
  }

  private async processNote(noteFile: TFile, showNoChangeNotice = true): Promise<void> {
    if (this.processingFiles.has(noteFile.path)) return;
    if (noteFile.extension !== "md" || this.isPathExcluded(noteFile)) return;

    this.processingFiles.add(noteFile.path);
    try {
      const originalContent = await this.app.vault.cachedRead(noteFile);
      const result = await this.transcribeAudioLinks(noteFile, originalContent);
      if (result.content !== originalContent) {
        await this.app.vault.modify(noteFile, result.content);
        notify(`Inserted ${result.transcribedCount} transcript block(s) in ${noteFile.path}.`, this.settings.showNotifications, 10000);
      } else if (showNoChangeNotice) {
        notify(
          `No new transcript was inserted in ${noteFile.path}.\nUse "Diagnose local audio in current note" for details.`,
          this.settings.showNotifications,
          12000
        );
      }
    } catch (error) {
      notify(`Transcription failed for ${noteFile.path}:\n${errorMessage(error)}`, this.settings.showNotifications, 20000);
      console.error(APP_TITLE, error);
    } finally {
      this.processingFiles.delete(noteFile.path);
    }
  }

  private async transcribeAudioLinks(
    noteFile: TFile,
    originalContent: string
  ): Promise<{ content: string; transcribedCount: number }> {
    const provider = createProvider(this.settings.provider);
    const report = this.collectAudioTargets(noteFile, originalContent);
    let content = originalContent;
    let transcribedCount = 0;
    let searchFrom = 0;

    if (report.targets.length > 0) {
      notify(
        `Found ${report.targets.length} local audio file(s). Using ${provider.name}...`,
        this.settings.showNotifications,
        10000
      );
    }

    for (const { link, audioFile } of report.targets) {
      const audioData = await this.app.vault.adapter.readBinary(audioFile.path);
      const audioHash = sha256Hex(audioData);
      const existingBlock = findTranscriptBlock(content, audioFile.path);

      if (existingBlock && (!this.settings.replaceExistingTranscripts || existingBlock.hash === audioHash)) {
        continue;
      }

      const transcript = await provider.transcribe({
        app: this.app,
        noteFile,
        audioFile,
        audioData,
        audioHash,
        settings: this.settings
      });
      const block = formatTranscriptBlock(audioFile, audioHash, transcript, this.settings.transcriptFormatting);

      if (existingBlock && this.settings.replaceExistingTranscripts) {
        content = `${content.slice(0, existingBlock.start)}${block}${content.slice(existingBlock.end)}`;
        transcribedCount++;
        continue;
      }

      let linkIndex = content.indexOf(link.fullText, searchFrom);
      if (linkIndex === -1) {
        linkIndex = content.indexOf(link.fullText);
      }
      if (linkIndex === -1) continue;
      const insertAt = linkIndex + link.fullText.length;
      content = `${content.slice(0, insertAt)}\n\n${block}${content.slice(insertAt)}`;
      searchFrom = insertAt + block.length;
      transcribedCount++;
    }

    return { content, transcribedCount };
  }

  private collectAudioTargets(
    noteFile: TFile,
    content: string
  ): {
    totalLinks: number;
    targets: { link: AudioLinkMatch; audioFile: TFile }[];
    unsupportedCount: number;
    existingTranscriptCount: number;
  } {
    const enabledExtensions = extensionSet(this.settings.enabledExtensions);
    const audioLinks = findAudioLinks(content);
    const byPath = new Map<string, { link: AudioLinkMatch; audioFile: TFile }>();
    let unsupportedCount = 0;

    for (const link of audioLinks) {
      const audioFile = this.resolveAudioLink(noteFile, link, enabledExtensions);
      if (!audioFile) {
        unsupportedCount++;
        continue;
      }

      const existing = byPath.get(audioFile.path);
      if (!existing || (!existing.link.isEmbed && link.isEmbed)) {
        byPath.set(audioFile.path, { link, audioFile });
      }
    }

    const targets = Array.from(byPath.values()).sort((a, b) => a.link.index - b.link.index);
    const existingTranscriptCount = targets.filter(({ audioFile }) => findTranscriptBlock(content, audioFile.path)).length;

    return {
      totalLinks: audioLinks.length,
      targets,
      unsupportedCount,
      existingTranscriptCount
    };
  }

  private resolveAudioLink(noteFile: TFile, link: AudioLinkMatch, enabledExtensions: Set<string>): TFile | null {
    const target = cleanLinkTarget(link.rawTarget);
    const extension = getExtension(target);
    if (!enabledExtensions.has(extension)) return null;

    return resolveVaultAudioFile(noteFile, target, (linkpath, sourcePath) => {
      const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      return file instanceof TFile ? file : null;
    });
  }

  private isPathExcluded(file: TFile): boolean {
    return isExcluded(file.parent?.path ?? "", this.settings.excludedFolders);
  }
}

function mergeSettings(data: unknown): LocalAudioPlusSettings {
  const saved = data && typeof data === "object" ? (data as Partial<LocalAudioPlusSettings> & Record<string, unknown>) : {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    provider: normalizeProvider(saved.provider),
    transcriptFormatting: normalizeTranscriptFormatting(saved.transcriptFormatting),
    proxy: {
      ...DEFAULT_SETTINGS.proxy,
      ...(saved.proxy ?? {})
    },
    openai: {
      ...DEFAULT_SETTINGS.openai,
      ...(saved.openai ?? {}),
      uploadFormat: normalizeOpenAIUploadFormat(asRecord(saved.openai).uploadFormat)
    },
    tencent: {
      ...DEFAULT_SETTINGS.tencent,
      ...(saved.tencent ?? {})
    }
  };
  delete (settings as Record<string, unknown>).xunfei;
  return settings;
}

function normalizeProvider(value: unknown): LocalAudioPlusSettings["provider"] {
  if (value === "openai" || value === "tencent") return value;
  if (value === "xunfei") return "tencent";
  return DEFAULT_SETTINGS.provider;
}

function normalizeOpenAIUploadFormat(value: unknown): LocalAudioPlusSettings["openai"]["uploadFormat"] {
  if (value === "base64" || value === "formData") return value;
  return DEFAULT_SETTINGS.openai.uploadFormat;
}

function normalizeTranscriptFormatting(value: unknown): LocalAudioPlusSettings["transcriptFormatting"] {
  if (value === "autoParagraphs" || value === "plain") return value;
  return DEFAULT_SETTINGS.transcriptFormatting;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
