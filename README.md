# Facebook Ads 多国广告抓取系统（Web 版）

该项目提供一个可视化界面，使用 Node.js、Express 与 Puppeteer 自动登录 Facebook Ads Library 并抓取广告数量统计，支持全域与多国两种模式，并输出 Excel 报表。

## 功能
- 上传关键词文件（TXT 或 CSV）或直接粘贴关键词
- 模式一：统计全球「正在投放」广告数量
- 模式二：统计多个国家（默认为 PL、RO、IT、GR、HR、BG、HU、CZ、SK，可自定义组合）的广告数量
- 实时日志与进度条显示
- 多国模式支持多选国家，并在 Excel 生成「详细」与「关键词汇总」双表格
- 自动将 Excel 报表输出到桌面 `已完成数据提取` 目录
- Render / Replit / Codex 一键部署支持

## 快速开始
```bash
npm install
npm start
```
启动后访问 http://localhost:3000，上传或粘贴关键词即可。

## 自定义多国统计国家

在网页中选择「模式二：多国广告数量对比」时，会显示默认支持的国家列表。
可以使用「全选 / 全不选」快捷按钮，也可以自定义任意组合。

若表单提交失败，请确认至少勾选了一个国家。

## 环境变量
- `FB_EMAIL` 与 `FB_PASSWORD`：当需要自动登录 Facebook 时提供的凭证。
- `PUPPETEER_EXECUTABLE_PATH`：自定义浏览器路径。

## 授权协议
MIT License © 2025 Chen Xiyang
