# 文本对比工具 · DiffNote

## 在线地址

[打开文本对比工具](https://text-compare-nov9-k7m.syrupy-crumb-2402.chatgpt.site/)

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
