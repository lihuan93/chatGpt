# 文本对比工具 · DiffNote

## Chrome 扩展安装（推荐）

直接下载 v1.1.0：https://github.com/lihuan93/chatGpt/raw/refs/heads/main/text-compare/releases/diffnote-chrome-1.1.0.zip

安装包固定放在 `releases/diffnote-chrome-1.1.0.zip`，解压后即可安装，无需联网或启动服务器。

1. 打开 Chrome，输入 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后包含 `manifest.json` 的文件夹。若使用完整源码仓库，请选择本项目的 `extension/` 文件夹。
4. 在工具栏的扩展菜单中固定 DiffNote，点击图标即可在新标签页打开文本对比。

扩展默认 JSON，保留 Java、XML 等语言选择、代码块折叠与差异高亮。所有资源随扩展打包，可离线使用，不申请网站读取权限，不上传文本，不自动保存输入内容。关闭或刷新对比页会清空输入。

目前提供开发者模式安装包，尚未上架 Chrome 应用商店。更新时替换解压目录内容，再到扩展管理页点击「重新加载」。

### 修改和重新打包扩展

```sh
npm ci
npm run build:extension
```

构建会更新 `extension/` 和 `releases/diffnote-chrome-1.1.0.zip`。扩展配置位于 `chrome/manifest.json`，图标点击逻辑位于 `chrome/background.js`。安装包与 `extension/` 都是生成文件，请修改 `dist/`、`src/` 或 `chrome/` 后重新构建。

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
