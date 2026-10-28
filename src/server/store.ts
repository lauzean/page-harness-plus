// On-disk layout under <project>/.page-harness/:
//   chats/<id>/meta.json     chat metadata
//   chats/<id>/events.jsonl  append-only event log
//   chats/<id>/queue.json    messages waiting to run
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatEvent, ChatMeta, QueueItem } from '../shared/protocol'

export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export class ChatStore {
  readonly root: string

  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'chats')
    mkdirSync(this.root, { recursive: true })
  }

  private dir(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error('bad chat id')
    return path.join(this.root, id)
  }

  listMetas(): ChatMeta[] {
    const out: ChatMeta[] = []
    for (const name of readdirSync(this.root)) {
      const m = readJson<ChatMeta | null>(path.join(this.root, name, 'meta.json'), null)
      if (m && m.id === name) out.push(m)
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  saveMeta(meta: ChatMeta): void {
    writeJsonAtomic(path.join(this.dir(meta.id), 'meta.json'), meta)
  }

  append(chatId: string, ev: ChatEvent): void {
    const d = this.dir(chatId)
    mkdirSync(d, { recursive: true })
    appendFileSync(path.join(d, 'events.jsonl'), JSON.stringify(ev) + '\n')
  }

  /** Replaces a chat's event log. Used by Claude session imports, which carry their own seq/ts. */
  writeEvents(chatId: string, events: ChatEvent[]): void {
    const d = this.dir(chatId)
    mkdirSync(d, { recursive: true })
    writeFileSync(path.join(d, 'events.jsonl'), events.map((e) => JSON.stringify(e) + '\n').join(''))
  }

  readEvents(chatId: string): ChatEvent[] {
    const file = path.join(this.dir(chatId), 'events.jsonl')
    if (!existsSync(file)) return []
    const out: ChatEvent[] = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // A torn final line after a crash; skip it.
      }
    }
    return out
  }

  saveQueue(chatId: string, queue: QueueItem[]): void {
    writeJsonAtomic(path.join(this.dir(chatId), 'queue.json'), queue)
  }

  loadQueue(chatId: string): QueueItem[] {
    return readJson<QueueItem[]>(path.join(this.dir(chatId), 'queue.json'), [])
  }

  delete(chatId: string): void {
    rmSync(this.dir(chatId), { recursive: true, force: true })
  }
}
