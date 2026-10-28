# page-harness-plus 定制说明

本仓库是 [Tencent/page-harness](https://github.com/Tencent/page-harness) 的 fork，在上游 0.1.10 基础上增加了三项定制：

1. 聊天记录页支持同步 Claude Code 会话
2. 取点后可复制元素信息到其他 IDE
3. 全局 skill：一句话启动 Page Harness 服务

---

## 1. 同步 Claude Code 会话

**入口**：聊天记录页（`http://localhost:<control-port>/__ph/history`）左侧的「同步 Claude 会话」。

**工作原理**

- 扫描 `~/.claude/projects/<编码后的项目路径>/*.jsonl`，即 Claude Code 本机的会话记录。
- 把会话转换成 Page Harness 的事件日志，写入 `<项目>/.page-harness/chats/<id>/`。
- 导入时把 `agentSessionId` 设为原会话 id；在面板里继续对话时用 `claude --resume <id>`，Agent 直接接上原来的上下文，**不需要重新读一遍代码**。
- 会话标题优先取 Claude 的 `ai-title`，其次取第一条真实的用户消息；Page Harness 注入的 `<instructions>`、`<page>`、`<picked-elements>`、`<system-reminder>` 等上下文块会自动清理。

**同步策略**

| 情况 | 行为 |
|---|---|
| 未导入 | 新建对话 |
| 已导入，会话文件有更新 | 重写该对话的事件日志 |
| 已导入，并在 Page Harness 里继续过 | 跳过，避免覆盖新对话 |
| 会话正在运行 | 跳过 |

**接口**

- `GET /__ph/api/claude/sessions`：列出当前项目的 Claude 会话及导入状态
- `POST /__ph/api/claude/sync`：`{ "ids": ["<sessionId>"] }`，省略 ids 表示全部
- 可用环境变量 `PH_CLAUDE_PROJECTS_DIR` 覆盖 `~/.claude/projects`

---

## 2. 取点后复制

在页面上取点后，操作栏在「引用到对话」后面新增「复制」按钮。复制内容是 Markdown：

```
Picked element (Page Harness)
URL: <页面地址>
Selector: <CSS 选择器>
Tag: <标签名>
Text: <可见文字>

```html
<元素 HTML 片段>
```
```

可直接粘贴到 Cursor、IDEA AI、ChatGPT 等工具里。评审模式、书签模式下同样可用（不依赖 Agent）。

---

## 3. 全局 skill：一句话启动

Skill 位于用户级目录：

- `C:\Users\lzz_z\.claude\skills\page-harness\SKILL.md`
- `C:\Users\lzz_z\.claude\skills\page-harness\start.mjs`

用法（对 Agent 说）：

> 启动 page harness

或直接执行：

```bash
node "C:\Users\lzz_z\.claude\skills\page-harness\start.mjs" --url 5173 --project "E:\path\to\app" --agent claude --json
node "C:\Users\lzz_z\.claude\skills\page-harness\start.mjs" --project "E:\path\to\app" --stop
```

脚本能力：

- 源码比 `dist` 新时自动构建
- 同一项目复用已运行实例
- 端口冲突自动顺延
- Windows 下用 PowerShell `Start-Process` 启动，不占用调用方的 stdout
- 状态写入 `<项目>/.page-harness/server.json`

---

## 构建与测试

```bash
npm install
npm run build
npm run typecheck
npm test
```

新增测试：

- `test/claude-sessions.test.ts`：路径编码、会话扫描、解析、事件序列化
- `client/shared/pick-text.test.ts`：复制内容格式

> 注：`test/agents.test.ts` 在 Windows 下因 fake-bin 脚本的兼容性问题有 13 个失败，与本次定制无关。
