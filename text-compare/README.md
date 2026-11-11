# 文本对比工具 · DiffNote

## Chrome 扩展安装（推荐）

已安装用户优先使用 macOS 原目录升级包：
https://github.com/lihuan93/chatGpt/raw/refs/heads/main/text-compare/releases/diffnote-chrome-1.2.0-upgrade-mac.zip

首次安装完整包：
https://github.com/lihuan93/chatGpt/raw/refs/heads/main/text-compare/releases/diffnote-chrome-1.2.0.zip

安装包固定放在 `releases/diffnote-chrome-1.2.0.zip`，解压后即可安装，无需联网或启动服务器。

1. 打开 Chrome，输入 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后包含 `manifest.json` 的文件夹。若使用完整源码仓库，请选择本项目的 `extension/` 文件夹。
4. 在工具栏的扩展菜单中固定 DiffNote，点击图标即可在新标签页打开文本对比。

扩展默认 JSON，保留 Java、XML 等语言选择、代码块折叠与差异高亮。所有资源随扩展打包，可离线使用，不申请网站读取权限，不上传文本，不自动保存输入内容。关闭或刷新对比页会清空输入。

目前提供开发者模式安装包，尚未上架 Chrome 应用商店。

### 原目录升级（macOS）

参考“本地账号簿”插件的升级流程，优先使用 `diffnote-chrome-1.2.0-upgrade-mac.zip`：

1. 保存正在对比的文本，关闭旧 DiffNote 标签页。未保存文本不会进入代码备份。
2. 把升级包解压到独立位置，保留 `更新Mac.command`、`升级说明.txt` 和旁边的 `diffnote/` 文件夹。不要替换或删除整个旧安装文件夹。
3. 双击 `更新Mac.command`，选择 Chrome 原来加载的目录，即旧 `manifest.json` 所在层。旧目录可以是 `diffnote-chrome-1.0.0`、`extension` 或自定义名称。也可从本项目目录运行脚本，使用旁边的 `extension/` 作为新版资源。
4. 脚本校验新版和原目录身份、备份旧代码，再逐文件更新；最后写入并校验清单。保留原目录及已有清单文件本身，不访问 Chrome 配置。
5. 等待“升级完成”，在 `chrome://extensions` 的原条目点「重新加载」或错误弹窗的「重试」，再点击扩展图标打开。

若脚本不能双击，可在终端输入 `bash `，拖入 `.command` 文件后回车；也支持 `sh 更新Mac.command`。不需要 sudo 或关闭 macOS 安全设置。

脚本备份在原目录旁的 `diffnote-backup.XXXXXX`，只包含代码。可修复旧 DiffNote 目录中缺失或损坏的 `manifest.json`。若整个原目录已被删除，需找回原目录或重新加载新版目录。

若 Chrome 提示 `Manifest is not valid JSON` / `Can't read file`，先确认原目录根层直接有完整解压的清单文件，没有多嵌套一层、没有云盘占位文件。清单校验通过仍不可读时，检查 macOS「隐私与安全性 → 文件与文件夹」中的 Chrome 目录访问权限（如有开关）。原目录升级可避免替换整个文件夹，但无法自动修复系统权限；没有具体报错时不能断定原因。

本包为 v1.2.0，新增结果同步滚动与输入框高度联动。升级后需要手动重新加载，不提供商店自动更新。

### 修改和重新打包扩展

```sh
npm ci
npm run build:extension
```

构建会更新 `extension/`、完整包 `releases/diffnote-chrome-1.2.0.zip` 和原目录升级包 `releases/diffnote-chrome-1.2.0-upgrade-mac.zip`。扩展配置位于 `chrome/manifest.json`，图标点击逻辑位于 `chrome/background.js`。安装包与 `extension/` 都是生成文件，请修改 `dist/`、`src/` 或 `chrome/` 后重新构建。

## 同步滚动与输入框高度

- 对比结果左右双向同步滚动：两边长度不同或折叠状态不同时按可滚动范围的比例联动，滚到底时两边都到底。这是滚动进度同步，不保证不同文本的行号逐行对齐。
- 拖动任一输入代码框右下角调整高度时，另一个框同步变化；仍保留原有的最小和最大高度限制。
- 重新对比、切换语言或清空后，不会保留旧结果的滚动监听。

联动功能的浏览器回归测试：`CHROMIUM_PATH=/usr/bin/chromium npm run test:layout`，覆盖双向滚动、长短文本、单侧折叠、原生拖动手柄、清空/重新对比和窄屏。

## 代码折叠与快捷键

原始文本、修改后文本、左右对比结果都支持以下操作：

- **折叠当前**：选中多行时只折叠所选文本；没有选区时，折叠光标或鼠标上次停留位置所在的最内层代码块。单行选区不折叠，避免误折叠外层。
- **展开当前**：只打开当前位置的一个折叠层级，内层保持原来的折叠状态。
- **全部折叠**：包含每一个内层代码块。先展开外层时，内层仍然折叠。
- **全部展开**：清除所有层级以及手动选区的折叠。

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 折叠当前 / 选区 | Ctrl + Shift + [ | Cmd + Option + [ |
| 展开当前 | Ctrl + Shift + ] | Cmd + Option + ] |
| 全部折叠 | Ctrl + Alt + [ | Cmd + Option + Shift + [ |
| 全部展开 | Ctrl + Alt + ] | Cmd + Option + Shift + ] |

使用快捷键前先点击目标代码框；快捷键作用于光标或选区，鼠标悬停位置用于工具栏按钮。对比结果顶部的「全部」按钮同时作用于左右结果，输入框的「全部」按钮仅作用于对应输入框。用法也可在页面工具栏的「折叠用法 / 快捷键」中查看。

交付安装包时提供可直接下载的链接，避免要求用户先打开文件预览。

### 折叠回归测试

测试基于 Chromium，覆盖 JSON / Java / XML 的四个代码框、选区折叠、鼠标悬停目标、多层折叠、文本完整性和快捷键。先执行 `npm run build:extension`；若已安装 Chromium，可执行：

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:folding
TEST_MAC=1 CHROMIUM_PATH=/usr/bin/chromium npm run test:folding
```

`CHROMIUM_PATH` 改为本机浏览器路径；第二条命令在 Chromium 中模拟 macOS 键位。未指定浏览器路径时使用 Playwright 默认安装的 Chromium，可用 `npx playwright-core install chromium` 安装。测试验证打包页面及扩展 CSP，不代替实际扩展安装验证。

升级脚本可在 Linux 上执行流程模拟测试：`python3 tests/upgrade.py`，覆盖备份、原目录/清单 inode 保留、损坏清单修复、误选目录、符号链接拒绝、Bash/sh 和仓库布局。测试用 Node 模拟 macOS Foundation 文件读取桥接；未替代 Mac 实机的 Finder、JXA 和 Chrome 升级验证。

## 在线地址

打开文本对比工具：https://text-compare-nov9-k7m.syrupy-crumb-2402.chatgpt.site/

固定链接：https://text-compare-nov9-k7m.syrupy-crumb-2402.chatgpt.site/

后续功能更新继续使用此地址。如在线地址变更，请同步更新本文件。

默认语言为 JSON，支持语言选择、差异高亮和代码块折叠。文本在浏览器本地处理。

## 本地运行

在本目录执行：

```sh
python3 -m http.server 8000 --directory dist
```

打开 http://localhost:8000 。仓库已包含构建好的静态页面，无需先安装依赖。

## 修改代码编辑器

页面和对比逻辑位于 `dist/`，支持代码块折叠的编辑器源码位于 `src/code-editor.js`。
修改编辑器源码后，在本目录执行：

```sh
npm ci
npm run build
```

构建结果输出到 `dist/vendor/code-editor.js`。第三方许可证位于 `dist/vendor/code-editor.LICENSE.txt`。

## 仓库组织

本项目在 GitHub 仓库中独立放在 `text-compare/` 子目录，与其他项目并列。
