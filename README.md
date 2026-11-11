# 我的实验项目

一个仓库可以按文件夹容纳多个小项目；需要独立维护或发布时，可将项目拆到单独仓库。

## 个人项目看板

- 在线地址：[https://shixu-project-board-lh93.syrupy-crumb-2402.chatgpt.site](https://shixu-project-board-lh93.syrupy-crumb-2402.chatgpt.site)
- 访问方式：私有访问，仅所有者登录 ChatGPT 后可打开。
- 项目文档：[project-board/README.md](project-board/README.md)

源码位于 `project-board/dist/`，使用原生 HTML、CSS 和 JavaScript，无需安装依赖或构建。

```sh
cd project-board
python3 -m http.server 8000 --directory dist
```

打开 http://localhost:8000 。支持新增、编辑、删除项目，状态切换、搜索、筛选及 JSON 导入导出。首次使用包含四个演示项目，可以编辑或删除。数据仅保存在当前浏览器的 localStorage，不会自动跨设备同步；清除网站数据会丢失记录，请定期导出 JSON 备份。导入会追加项目，保留已有数据。

新增“一键整理周报”：按北京时间周一至周日汇总本周完成、当前进行中及待开始项目，支持编辑、复制和下载 Markdown。详见 `project-board/README.md`。

## 本地账号簿 Chrome 扩展

源码及安装说明：[local-password-manager/README.md](local-password-manager/README.md)。

支持浏览器本地保存账号密码、按域名分组、JSON 导入导出，以及选择当前网站的账号填充登录表单。密码以明文保存，使用前请阅读项目文档中的存储说明。

在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载 `local-password-manager/` 文件夹。macOS 原目录升级脚本也位于该子目录内。

## 文本对比工具 · DiffNote

源码位于 [`text-compare/`](text-compare/)，在线地址固定记录在 [`text-compare/README.md`](text-compare/README.md)。

[在线使用](https://text-compare-nov9-k7m.syrupy-crumb-2402.chatgpt.site/)

默认使用 JSON，支持 Java、XML 等常见语言、差异高亮和代码块折叠。文本在浏览器本地处理。

Chrome 扩展：在 `chrome://extensions` 开启开发者模式，点击「加载已解压的扩展程序」，选择 `text-compare/extension/`。点击扩展图标，在新标签页离线使用。安装 ZIP 位于 `text-compare/releases/diffnote-chrome-1.3.0.zip`，完整步骤见项目 README。支持折叠选区或当前代码块、包含内层的全部折叠、全部展开与快捷键。差异行左右显示整行背景色；左右结果同步滚动，两个输入框拖动高度时联动；已安装用户优先使用项目 README 中的原目录升级包。

```sh
cd text-compare
python3 -m http.server 8000 --directory dist
```

已包含构建好的静态页面，可直接运行；编辑器源码修改与构建步骤见项目 README。
