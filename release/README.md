# Local Audio Plus 离线安装

这个压缩包可以离线安装 Local Audio Plus 到 Obsidian。

包内文件：

```text
main.js
manifest.json
styles.css
install.ps1
install.sh
README.md
```

## 自动安装

安装脚本会读取 Obsidian 本地配置，优先选择当前打开的仓库；如果没有找到当前打开的仓库，会选择最近打开的仓库。脚本会把插件复制到：

```text
<vault>/.obsidian/plugins/obsidian-local-audio-plus/
```

并把插件 ID 写入：

```text
<vault>/.obsidian/community-plugins.json
```

安装后如果 Obsidian 没有立即显示插件，请重启 Obsidian，或在第三方插件页面重新打开插件列表。

### Windows PowerShell

在解压后的 `obsidian-local-audio-plus` 文件夹里打开 PowerShell，然后运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

### Linux

在解压后的 `obsidian-local-audio-plus` 文件夹里打开终端，然后运行：

```bash
chmod +x ./install.sh
./install.sh
```

## 手动安装

如果自动安装脚本找不到 Obsidian 仓库，可以手动复制整个 `obsidian-local-audio-plus` 文件夹到：

```text
<vault>/.obsidian/plugins/
```

最终目录应类似：

```text
<vault>/.obsidian/plugins/obsidian-local-audio-plus/main.js
<vault>/.obsidian/plugins/obsidian-local-audio-plus/manifest.json
<vault>/.obsidian/plugins/obsidian-local-audio-plus/styles.css
```
