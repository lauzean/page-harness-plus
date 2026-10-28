// Claude Code 会话同步：扫描 ~/.claude/projects 下当前项目的 .jsonl 会话记录，
// 把其中的对话转换成 Page Harness 的事件日志，便于在聊天记录页查看并原会话续聊。
import { createReadStream, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import type { ChatEvent, ChatEventBody, Usage, UserMessage } from '../shared/protocol'
import { clip, displayToolName, stringifyOutput } from '../agents/util'

/** 会话里的一次“轮次”：一条真实用户消息，到下一次真实用户消息之前的所有内容。 */
export interface ImportedTurn {
  ts: number
  endTs: number
  userText: string
  /** 按发生顺序排列的事件体，序列化时再补上 chatId/turnId/seq/ts。 */
  entries: Array<{ ts: number; body: ChatEventBody }>
  usage?: Usage
}

/** 一个完整解析后的 Claude 会话，可直接写入聊天记录。 */
export interface ParsedClaudeSession {
  sessionId: string
  file: string
  sizeBytes: number
  mtimeMs: number
  createdAt: number
  updatedAt: number
  title: string
  preview?: string
  cwd?: string
  gitBranch?: string
  turns: ImportedTurn[]
}

/** 扫描阶段用的轻量摘要，不保留正文。 */
export interface ClaudeSessionSummary {
  sessionId: string
  file: string
  sizeBytes: number
  mtimeMs: number
  createdAt: number
  updatedAt: number
  title: string
  preview?: string
  cwd?: string
  gitBranch?: string
  turns: number
}

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
const TITLE_MAX = 48
const PREVIEW_MAX = 120
const TOOL_OUTPUT_MAX = 4000

/** 扫描结果缓存：文件大小和修改时间未变时无需重新解析。 */
const summaryCache = new Map<string, { sizeBytes: number; mtimeMs: number; summary: ClaudeSessionSummary }>()

/** Claude Code 的项目目录根，测试或特殊环境可用环境变量覆盖。 */
export function claudeProjectsRoot(): string {
  return process.env.PH_CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')
}

/**
 * Claude Code 把项目绝对路径编码成目录名：非字母数字和连字符一律换成 "-"。
 * 例如 E:\data\UI王梦圆 -> E--data-UI---。
 */
export function encodeProjectDir(project: string): string {
  return path.resolve(project).replace(/[^A-Za-z0-9-]/g, '-')
}

/** 当前项目对应的 Claude Code 会话目录。 */
export function claudeProjectDir(project: string): string {
  return path.join(claudeProjectsRoot(), encodeProjectDir(project))
}

/** 读取会话记录并解析。collectTurns=false 时只统计摘要，内存占用最小。 */
async function readSession(file: string, sessionId: string, collectTurns: boolean): Promise<{ summary: ClaudeSessionSummary; turns: ImportedTurn[] }> {
  const stat = statSync(file)
  let firstTs = 0
  let lastTs = 0
  let aiTitle = ''
  let firstUserText = ''
  let lastUserText = ''
  let lastAssistantText = ''
  let lastSummary = ''
  let cwd = ''
  let gitBranch = ''
  let turnCount = 0
  const turns: ImportedTurn[] = []
  let current: ImportedTurn | null = null
  let currentUsage = new Map<string, Usage>()
  /** tool_use id -> 所属轮次，让 tool_result 能回到正确的轮次里更新状态。 */
  const toolTurns = new Map<string, ImportedTurn>()
  /** tool_use id -> 工具名，tool_result 更新状态时保留原名称。 */
  const toolNames = new Map<string, string>()
  /** 同一条事件可能被流式写多次，用 uuid 去重。 */
  const seen = new Set<string>()

  /** 结束当前轮次并写入结束时间。 */
  const finishTurn = (ts: number) => {
    if (!current) return
    current.endTs = Math.max(current.endTs, ts)
    if (currentUsage.size) current.usage = sumUsage(currentUsage)
    current = null
    currentUsage = new Map()
  }

  /** 确保存在一个可写入的轮次；有些会话会先出现 assistant 行。 */
  const ensureTurn = (ts: number) => {
    if (!current) {
      current = { ts: ts || stat.mtimeMs, endTs: ts || stat.mtimeMs, userText: '', entries: [] }
      turns.push(current)
    }
    return current
  }

  /** 追加一条事件到当前轮次。 */
  const push = (ts: number, body: ChatEventBody) => {
    if (!collectTurns) return
    const turn = ensureTurn(ts)
    turn.entries.push({ ts: ts || turn.ts, body })
    turn.endTs = Math.max(turn.endTs, ts || turn.ts)
  }

  const rl = readline.createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object' || o.isSidechain === true) continue
    // 同一事件在部分 Claude 版本里会分多行追加同一个 uuid。
    if (typeof o.uuid === 'string') {
      if (seen.has(o.uuid)) continue
      seen.add(o.uuid)
    }
    const ts = timeOf(o)
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts
      if (ts > lastTs) lastTs = ts
    }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
    if (!gitBranch && typeof o.gitBranch === 'string') gitBranch = o.gitBranch

    switch (o.type) {
      case 'ai-title':
        if (typeof o.aiTitle === 'string' && o.aiTitle.trim()) aiTitle = o.aiTitle.trim()
        break
      case 'summary':
        if (typeof o.summary === 'string' && o.summary.trim()) lastSummary = o.summary.trim()
        break
      case 'last-prompt':
        if (typeof o.lastPrompt === 'string' && o.lastPrompt.trim()) lastUserText = cleanUserText(o.lastPrompt)
        break
      case 'user': {
        if (o.isMeta === true) break
        for (const block of contentBlocks(o.message?.content)) {
          if (block.type === 'tool_result') {
            // 工具结果统一写回 tool_use 所在的轮次。
            const toolId = String(block.tool_use_id ?? '')
            const turn = toolTurns.get(toolId)
            if (!turn) continue
            const status = block.is_error ? 'error' : 'done'
            turn.entries.push({
              ts: ts || turn.ts,
              body: { t: 'tool', id: toolId, name: toolNames.get(toolId) ?? 'tool', status, output: clip(stringifyOutput(block.content), TOOL_OUTPUT_MAX) },
            })
            turn.endTs = Math.max(turn.endTs, ts || turn.ts)
            continue
          }
          if (block.type !== 'text' || typeof block.text !== 'string') continue
          const text = cleanUserText(block.text)
          if (!text) continue
          // 真实用户消息：结束上一轮，开启新一轮。
          finishTurn(ts)
          turnCount++
          if (!firstUserText) firstUserText = text
          lastUserText = text
          if (collectTurns) {
            current = { ts: ts || stat.mtimeMs, endTs: ts || stat.mtimeMs, userText: text, entries: [] }
            turns.push(current)
            currentUsage = new Map()
          }
        }
        break
      }
      case 'assistant': {
        const msg = o.message ?? {}
        const usage = usageOf(msg.usage)
        const usageKey = String(msg.id ?? o.uuid ?? o.timestamp ?? '')
        for (const block of contentBlocks(msg.content)) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            lastAssistantText = block.text
            push(ts, { t: 'text', delta: block.text })
          } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
            push(ts, { t: 'thinking', delta: block.thinking })
          } else if (block.type === 'tool_use') {
            const rawName = String(block.name ?? 'tool')
            const name = displayToolName(rawName)
            const id = String(block.id ?? '')
            toolNames.set(id, name)
            // 摘要模式不需要保存事件，避免为大文件分配无用内存。
            if (!collectTurns) continue
            const fileKey = FILE_TOOLS[rawName]
            const file = fileKey && block.input?.[fileKey]
            const turn = ensureTurn(ts)
            toolTurns.set(id, turn)
            turn.entries.push({
              ts: ts || turn.ts,
              body: { t: 'tool', id, name, input: block.input, status: 'start', files: file ? [String(file)] : undefined },
            })
            turn.endTs = Math.max(turn.endTs, ts || turn.ts)
          }
        }
        if (usage && current && usageKey) currentUsage.set(usageKey, usage)
        break
      }
    }
  }
  finishTurn(lastTs || stat.mtimeMs)

  const title = truncate(aiTitle || firstUserText || lastUserText || lastSummary || lastAssistantText || `Claude session ${sessionId.slice(0, 8)}`, TITLE_MAX)
  const previewText = truncate(lastAssistantText || lastUserText || lastSummary, PREVIEW_MAX)
  const summary: ClaudeSessionSummary = {
    sessionId,
    file,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    createdAt: firstTs || stat.birthtimeMs || stat.mtimeMs,
    updatedAt: lastTs || stat.mtimeMs,
    title: title || `Claude session ${sessionId.slice(0, 8)}`,
    preview: previewText || undefined,
    cwd: cwd || undefined,
    gitBranch: gitBranch || undefined,
    turns: turnCount,
  }
  return { summary, turns }
}

/** 扫描当前项目下所有 Claude Code 会话，按最近使用时间倒序。 */
export async function scanClaudeSessions(project: string): Promise<ClaudeSessionSummary[]> {
  const dir = claudeProjectDir(project)
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.jsonl') && !n.startsWith('agent-'))
  } catch {
    return []
  }
  const results = await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      const sessionId = name.slice(0, -'.jsonl'.length)
      try {
        const stat = statSync(file)
        if (!stat.isFile() || stat.size === 0) return null
        const cached = summaryCache.get(file)
        if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.summary
        const { summary } = await readSession(file, sessionId, false)
        summaryCache.set(file, { sizeBytes: stat.size, mtimeMs: stat.mtimeMs, summary })
        return summary
      } catch {
        return null
      }
    }),
  )
  return results.filter((s): s is ClaudeSessionSummary => !!s).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 完整解析一个会话，供导入使用。 */
export async function parseClaudeSession(file: string): Promise<ParsedClaudeSession> {
  const sessionId = path.basename(file, '.jsonl')
  const { summary, turns } = await readSession(file, sessionId, true)
  return { ...summary, turns }
}

/**
 * 把解析结果序列化成 Page Harness 事件。
 * turnStart 用于让多段导入的轮次编号不冲突，seqStart 同理。
 */
export function claudeTurnsToEvents(parsed: ParsedClaudeSession, chatId: string, turnStart = 0, seqStart = 0): ChatEvent[] {
  const events: ChatEvent[] = []
  let seq = seqStart
  parsed.turns.forEach((turn, i) => {
    const turnId = `t_cl_${turnStart + i + 1}`
    const user: UserMessage = { text: turn.userText, attachments: [], picks: [] }
    events.push({ t: 'turn_begin', chatId, turnId, seq: ++seq, ts: turn.ts, user, agent: 'claude' })
    for (const entry of turn.entries) {
      events.push({ ...entry.body, chatId, turnId, seq: ++seq, ts: entry.ts } as ChatEvent)
    }
    events.push({
      t: 'turn_end',
      chatId,
      turnId,
      seq: ++seq,
      ts: turn.endTs,
      status: 'done',
      usage: turn.usage,
      durationMs: Math.max(0, turn.endTs - turn.ts),
    })
  })
  return events
}

/** message.content 可能是字符串或内容块数组，统一成数组。 */
function contentBlocks(content: unknown): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

/** 取一行记录的时间戳，兼容 ISO 字符串和毫秒数。 */
function timeOf(o: any): number {
  const raw = o?.timestamp ?? o?.ts
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    if (Number.isFinite(t)) return t
  }
  return 0
}

/** 把 Claude 的 usage 字段换算成 Page Harness 的 Usage。 */
function usageOf(u: any): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  const usage: Usage = {
    inputTokens: input || undefined,
    outputTokens: u.output_tokens,
    cachedTokens: u.cache_read_input_tokens,
    costUsd: u.total_cost_usd,
  }
  return usage.inputTokens || usage.outputTokens ? usage : undefined
}

/** 同一轮内多个 assistant 消息的用量相加，同一 message id 只算一次。 */
function sumUsage(byMessage: Map<string, Usage>): Usage | undefined {
  const out: Usage = {}
  let any = false
  for (const u of byMessage.values()) {
    any = true
    out.inputTokens = (out.inputTokens ?? 0) + (u.inputTokens ?? 0)
    out.outputTokens = (out.outputTokens ?? 0) + (u.outputTokens ?? 0)
    out.cachedTokens = (out.cachedTokens ?? 0) + (u.cachedTokens ?? 0)
    out.costUsd = (out.costUsd ?? 0) + (u.costUsd ?? 0)
  }
  return any ? out : undefined
}

/** 清洗用户消息：去掉 Page Harness 自己注入的说明、页面上下文块和 Claude 的系统提醒。 */
export function cleanUserText(text: string): string {
  let s = text
  if (s.startsWith('<instructions>') && s.includes('You are the coding agent behind Page Harness')) {
    const end = s.indexOf('</instructions>')
    if (end >= 0) s = s.slice(end + '</instructions>'.length)
  }
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  s = s.trimStart()
  // 只去掉开头由 buildPrompt 注入的上下文块，保留用户后面写的正文。
  s = s.replace(/^<page\b[^>]*\/>\s*/i, '')
  s = s.replace(/^<picked-elements>[\s\S]*?<\/picked-elements>\s*/i, '')
  s = s.replace(/^<marks>[\s\S]*?<\/marks>\s*/i, '')
  s = s.replace(/^<attachments\b[^>]*>[\s\S]*?<\/attachments>\s*/i, '')
  return s.trim()
}

/** 简单截断，避免标题/预览过长。 */
function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max) + '…' : one
}

/** 供测试清理缓存。 */
export function clearClaudeSessionCache(): void {
  summaryCache.clear()
}
