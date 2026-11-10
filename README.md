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
