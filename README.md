# Local Audio Plus

Obsidian plugin for scanning local audio links in notes and inserting transcripts.

Supported providers:

- OpenAI Audio Transcriptions
- Tencent Cloud recording file recognition (`CreateRecTask` with local base64 audio upload)
- iFlytek recording file transcription (`/v2/upload` + `/v2/getResult`)

OpenAI normal transcription can use `gpt-4o-mini-transcribe` for lower cost or `gpt-4o-transcribe` for higher accuracy. Speaker diarization uses `gpt-4o-transcribe-diarize`.

Tencent Cloud local upload uses `SourceType=1`, so the original audio file must be no larger than 5 MB.

iFlytek uses APPID, APIKey, and APISecret from the "录音文件转写大模型" console. In the API documentation, APIKey is also called `accessKeyId`, and APISecret is also called `accessKeySecret`. APISecret is signed as the original UTF-8 string; do not Base64 decode it. The default language mode is `autodialect`; `autominor` requires manual enablement from iFlytek.

The shared speaker diarization setting is used by supported providers. For iFlytek, enabling it sends `roleType=1` for general role separation, and the optional speaker count is sent as `roleNum` when it is between 1 and 10.

## 发布离线安装包

生成离线发布 zip：

```bash
npm run release
```

这个命令会先执行生产构建，然后生成：

```text
dist/obsidian-local-audio-plus-<version>.zip
```

`<version>` 来自当前仓库最新的 Git tag，例如 `v1.0.0` 会生成：

```text
dist/obsidian-local-audio-plus-1.0.0.zip
```

发布前请先创建 tag：

```bash
git tag v1.0.0
```

zip 内结构如下：

```text
obsidian-local-audio-plus/
  main.js
  manifest.json
  styles.css
  README.md
  install.ps1
  install.sh
```

其中：

- `install.ps1`：Windows PowerShell 自动安装脚本
- `install.sh`：Linux 自动安装脚本
- `README.md`：给离线安装用户看的说明

安装脚本会读取 Obsidian 本地配置，优先选择当前打开的 vault；如果没有当前打开的 vault，会选择最近打开的 vault。脚本会复制插件文件到：

```text
<vault>/.obsidian/plugins/obsidian-local-audio-plus/
```

并把插件 ID 写入：

```text
<vault>/.obsidian/community-plugins.json
```

Windows 用户解压 zip 后，在 `obsidian-local-audio-plus` 文件夹里运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

Linux 用户解压 zip 后，在 `obsidian-local-audio-plus` 文件夹里运行：

```bash
chmod +x ./install.sh
./install.sh
```
