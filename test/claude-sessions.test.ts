import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChatEvent } from '../src/shared/protocol'
import {
  claudeTurnsToEvents,
  cleanUserText,
  clearClaudeSessionCache,
  encodeProjectDir,
  parseClaudeSession,
  scanClaudeSessions,
} from '../src/server/claudeSessions'

// 测试数据放在项目内的 tmp/ 下，结束后删除，不写系统临时目录。
const root = path.join(process.cwd(), 'tmp', `claude-sessions-test-${process.pid}`)
const project = path.join(root, 'project')
const projectsRoot = path.join(root, 'claude-projects')
const sessionId = '11111111-2222-3333-4444-555555555555'

function sampleLines(): unknown[] {
  const usage = { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 }
  return [
    { type: 'ai-title', aiTitle: '导入测试会话', sessionId },
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-01-01T00:00:00.000Z' },
    {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>ctx</system-reminder>\n请修改按钮' }] },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-01-01T00:00:02.000Z',
      message: { id: 'm1', role: 'assistant', usage, content: [{ type: 'thinking', thinking: '想一想' }] },
    },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: '2026-01-01T00:00:03.000Z',
      message: { id: 'm1', role: 'assistant', usage, content: [{ type: 'text', text: '好的' }] },
    },
    {
      type: 'assistant',
      uuid: 'a3',
      timestamp: '2026-01-01T00:00:04.000Z',
      message: { id: 'm1', role: 'assistant', usage, content: [{ type: 'tool_use', id: 'tool1', name: 'mcp__page-harness__page_state', input: {} }] },
    },
    {
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-01-01T00:00:05.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: [{ type: 'text', text: '页面状态' }] }] },
    },
    {
      type: 'assistant',
      uuid: 'a4',
      timestamp: '2026-01-01T00:00:06.000Z',
      message: { id: 'm2', role: 'assistant', usage: { input_tokens: 20, output_tokens: 4 }, content: [{ type: 'text', text: '改好了' }] },
    },
    {
      type: 'user',
      uuid: 'u3',
      timestamp: '2026-01-01T00:00:10.000Z',
      message: { role: 'user', content: [{ type: 'text', text: '再改一处' }] },
    },
    {
      type: 'assistant',
      uuid: 'a5',
      timestamp: '2026-01-01T00:00:11.000Z',
      message: { id: 'm3', role: 'assistant', usage: { input_tokens: 30, output_tokens: 5 }, content: [{ type: 'text', text: '完成' }] },
    },
    // 同一个 uuid 重复写入时只能算一次。
    {
      type: 'assistant',
      uuid: 'a5',
      timestamp: '2026-01-01T00:00:12.000Z',
      message: { id: 'm3', role: 'assistant', usage: { input_tokens: 30, output_tokens: 5 }, content: [{ type: 'text', text: '重复' }] },
    },
  ]
}

function writeSession(file: string): void {
  writeFileSync(file, sampleLines().map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
}

beforeAll(() => {
  mkdirSync(path.join(project), { recursive: true })
  const dir = path.join(projectsRoot, encodeProjectDir(project))
  mkdirSync(dir, { recursive: true })
  writeSession(path.join(dir, `${sessionId}.jsonl`))
  process.env.PH_CLAUDE_PROJECTS_DIR = projectsRoot
})

afterAll(() => {
  delete process.env.PH_CLAUDE_PROJECTS_DIR
  clearClaudeSessionCache()
  rmSync(root, { recursive: true, force: true })
})

describe('Claude session scan', () => {
  it('encodes project paths the way Claude Code names its folders', () => {
    const p = process.platform === 'win32' ? 'E:\\data\\UI王梦圆' : '/data/UI王梦圆'
    const encoded = encodeProjectDir(p)
    if (process.platform === 'win32') expect(encoded).toBe('E--data-UI---')
    else expect(encoded).toBe('-data-UI---')
  })

  it('discovers sessions with title, turns and preview', async () => {
    const list = await scanClaudeSessions(project)
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe(sessionId)
    expect(list[0].title).toBe('导入测试会话')
    expect(list[0].turns).toBe(2)
    expect(list[0].preview).toBe('完成')
  })
})

describe('Claude session import', () => {
  it('cleans Page Harness instructions and system reminders', () => {
    const text = '<instructions>\nYou are the coding agent behind Page Harness.\n</instructions>\n\n把按钮改成蓝色'
    expect(cleanUserText(text)).toBe('把按钮改成蓝色')
    expect(cleanUserText('<system-reminder>a</system-reminder>正文')).toBe('正文')
  })

  it('parses turns, tool results and usage', async () => {
    const file = path.join(projectsRoot, encodeProjectDir(project), `${sessionId}.jsonl`)
    const parsed = await parseClaudeSession(file)
    expect(parsed.turns).toHaveLength(2)
    expect(parsed.turns[0].userText).toBe('请修改按钮')
    expect(parsed.turns[1].userText).toBe('再改一处')
    // 第一轮：thinking + text + 工具开始 + 工具完成 + text
    const kinds = parsed.turns[0].entries.map((e) => e.body.t)
    expect(kinds).toEqual(['thinking', 'text', 'tool', 'tool', 'text'])
    const toolDone = parsed.turns[0].entries[3].body
    expect(toolDone.t === 'tool' && toolDone.status).toBe('done')
    expect(toolDone.t === 'tool' && toolDone.name).toBe('page_state')
    expect(toolDone.t === 'tool' && toolDone.output).toContain('页面状态')
    // 同一 message id 的 usage 只算一次：m1(15/3) + m2(20/4)
    expect(parsed.turns[0].usage).toMatchObject({ inputTokens: 35, outputTokens: 7, cachedTokens: 5 })
    // 重复 uuid 的文本不会导入
    const text = parsed.turns[1].entries.map((e) => (e.body.t === 'text' ? e.body.delta : '')).join('')
    expect(text).toBe('完成')
  })

  it('serialises events with rising seq and stable turn ids', async () => {
    const file = path.join(projectsRoot, encodeProjectDir(project), `${sessionId}.jsonl`)
    const parsed = await parseClaudeSession(file)
    const events = claudeTurnsToEvents(parsed, 'c_test', 0, 0)
    expect(events[0]).toMatchObject({ t: 'turn_begin', chatId: 'c_test', turnId: 't_cl_1', seq: 1 })
    for (let i = 1; i < events.length; i++) expect(events[i].seq).toBe(events[i - 1].seq + 1)
    const ends = events.filter((e: ChatEvent) => e.t === 'turn_end')
    expect(ends).toHaveLength(2)
    expect(ends[0]).toMatchObject({ turnId: 't_cl_1', status: 'done' })
    expect(ends[1]).toMatchObject({ turnId: 't_cl_2', status: 'done' })
  })
})
