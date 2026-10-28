// Wire types shared by the server, the panel app and the page scripts.

export const PROTOCOL_VERSION = 1
export const PAGE_CONTROL_VERSION = 1
export const LIVE_VERSION = 1

export type Lang = 'zh-CN' | 'en'
export type Theme = 'dark' | 'light'

// ---------- page context ----------

export interface Pick {
  id: string
  selector: string
  tagName: string
  text: string
  outerHTML: string
  url: string
  ts: number
}

export interface ElementDescribe {
  selector: string
  tagName: string
  id?: string
  classes: string[]
  text: string
  outerHTML: string
  styles: Record<string, string>
  url: string
}

export interface Mark {
  n: number
  kind: 'stroke' | 'pin'
  /** Viewport coordinates at the time of drawing. */
  points?: Array<[number, number]>
  at?: [number, number]
  note?: string
  /** Selectors of elements under the mark. */
  targets: string[]
}

export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'file'
}

// ---------- Live variants ----------

export const LIVE_ACTIONS = [
  'bolder', 'quieter', 'polish', 'typeset', 'colorize', 'layout',
  'distill', 'adapt', 'animate', 'delight', 'overdrive', 'freeform',
] as const
export type LiveAction = (typeof LIVE_ACTIONS)[number]

export type LiveOp = 'generate' | 'insert' | 'steer' | 'refine' | 'revise' | 'accept' | 'discard' | 'retry' | 'mount_failed'
export type LiveDisplay = 'inplace' | 'compare'

export interface LiveRequest {
  op: LiveOp
  sid?: string
  target?: ElementDescribe
  position?: 'before' | 'after'
  action?: LiveAction
  prompt?: string
  notes?: string
  marks?: Mark[]
  count?: number
  display?: LiveDisplay
  variant?: number
  params?: Record<string, string>
  url?: string
  scope?: 'element' | 'page'
  reason?: string
  /** retry: accept the chosen variant once regenerated. */
  andAccept?: boolean
  /** Accept (review mode): before/after looks captured while the candidate was still on the page. */
  looks?: { selector: string; look: ReviewLook }[]
}

export type LiveStatus =
  | 'generating' | 'ready' | 'refining' | 'accepting' | 'discarding'
  | 'accepted' | 'discarded' | 'failed'

export interface LiveVariant {
  index: number
  label: string
  /** Review mode (no source): the page changes that make up this candidate. */
  changes?: LiveChange[]
}

/** One element changed by a no-source candidate. */
export interface LiveChange {
  selector: string
  anchor?: ReviewAnchor
  label?: string
  patch: ReviewPatch
}

/** Elements one no-source candidate may change. */
export const LIVE_MAX_CHANGES = 12

export interface LiveSession {
  sid: string
  chatId: string
  /** 'patch': no source, candidates are page changes applied by the overlay. */
  source?: 'code' | 'patch'
  kind: 'generate' | 'insert' | 'steer'
  status: LiveStatus
  display: LiveDisplay
  count: number
  variants: LiveVariant[]
  target?: ElementDescribe
  position?: 'before' | 'after'
  action?: LiveAction
  prompt?: string
  url?: string
  path?: string
  error?: string
  /** The last failed op left part of its change behind. */
  partial?: boolean
  accepted?: number
  /** The op that is running or last failed; used by retry. */
  pending?: LiveRequest
  createdAt: number
  updatedAt: number
}

export const LIVE_OPEN: LiveStatus[] = ['generating', 'ready', 'refining', 'accepting', 'discarding', 'failed']

// ---------- interactive asks ----------

export interface AskOption {
  id: string
  label: string
  description?: string
  recommended?: boolean
}

export interface AskQuestionItem {
  id: string
  prompt: string
  multiple?: boolean
  allowOther?: boolean
  options: AskOption[]
}

export interface AskFormField {
  name: string
  label: string
  type: 'text' | 'url' | 'textarea'
  placeholder?: string
  required?: boolean
  default?: string
}

export type AskSpec =
  | { kind: 'question'; title?: string; questions: AskQuestionItem[] }
  | { kind: 'form'; title?: string; description?: string; fields: AskFormField[] }

export type AskAnswer =
  | { skipped: true }
  | { cancelled: true }
  | { timeout: true }
  | { answers: Record<string, { selected: string[]; other?: string }> }
  | { values: Record<string, string> }

// ---------- messages, turns, events ----------

export interface UserMessage {
  text: string
  attachments: Attachment[]
  picks: Pick[]
  marks?: Mark[]
  live?: LiveRequest
  pageUrl?: string
}

export interface QueueItem extends UserMessage {
  id: string
  createdAt: number
  /** Browser tab that sent it; the turn's page commands go only there. */
  tab?: string
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  costUsd?: number
}

export type ToolStatus = 'start' | 'done' | 'error'

export type TurnEndStatus = 'done' | 'error' | 'cancelled' | 'interrupted'

export type ChatEventBody =
  | { t: 'turn_begin'; user: UserMessage; agent: string; model?: string }
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'tool'; id: string; name: string; input?: unknown; status: ToolStatus; output?: string; files?: string[] }
  | { t: 'ask'; askId: string; spec: AskSpec }
  | { t: 'ask_answer'; askId: string; answer: AskAnswer }
  | { t: 'artifact'; name: string; version: number }
  | { t: 'notice'; level: 'info' | 'warn'; message: string }
  | { t: 'error'; message: string }
  | { t: 'turn_end'; status: TurnEndStatus; usage?: Usage; durationMs: number; message?: string }

export type ChatEvent = ChatEventBody & { chatId: string; turnId: string; seq: number; ts: number }

export type TurnItem =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input?: unknown; status: ToolStatus; output?: string }
  | { kind: 'ask'; askId: string; spec: AskSpec; answer?: AskAnswer }
  | { kind: 'notice'; level: 'info' | 'warn'; message: string }
  | { kind: 'error'; message: string }

export type TurnStatus = 'running' | TurnEndStatus

export interface ModelInfo {
  id: string
  label: string
  /** The model the CLI uses when none is passed. */
  isDefault?: boolean
  /** Reasoning efforts the model accepts; empty or missing when it can't be set. */
  efforts?: string[]
  defaultEffort?: string
  /** Faster service tier the model offers, e.g. Codex "priority". */
  fastTier?: { id: string; description?: string }
  /** A stand-in offered because listing failed; it says nothing about the model's efforts. */
  fallback?: boolean
}

export interface TurnView {
  id: string
  ts: number
  user: UserMessage
  agent: string
  model?: string
  items: TurnItem[]
  status: TurnStatus
  endTs?: number
  usage?: Usage
  durationMs?: number
  message?: string
  files: string[]
  artifacts: Array<{ name: string; version: number }>
  lastSeq: number
}

export interface ChatMeta {
  id: string
  title: string
  agent: string
  model?: string
  /** Reasoning effort; unset means the model's default. */
  effort?: string
  /** Use the model's fast service tier. */
  fast?: boolean
  createdAt: number
  updatedAt: number
  turns: number
  agentSessionId?: string
  preview?: string
  /** Set when this chat mirrors a Claude Code transcript; the chat can be re-synced from it. */
  importedFrom?: ChatImport
}

/** A Claude Code session transcript imported into the chat history. */
export interface ChatImport {
  source: 'claude'
  sessionId: string
  /** Absolute path of the .jsonl transcript, used for re-sync. */
  file: string
  sizeBytes: number
  mtimeMs: number
  /** Number of turns written by the import. More turns in the chat means it was continued here. */
  turns: number
  syncedAt: number
}

/** A Claude Code session discovered on disk, for the history page's sync panel. */
export interface ClaudeSessionInfo {
  sessionId: string
  title: string
  preview?: string
  createdAt: number
  updatedAt: number
  turns: number
  sizeBytes: number
  cwd?: string
  gitBranch?: string
  /** Chat already imported from this session. */
  importedChatId?: string
  /** Turns written by the previous import. */
  importedTurns?: number
  /** The transcript has not changed since the import. */
  upToDate: boolean
  /** The chat has turns added in Page Harness, so re-syncing would overwrite them. */
  continued: boolean
}

export interface AgentInfo {
  id: string
  label: string
  available: boolean
  version?: string
  path?: string
  models?: ModelInfo[]
}

// ---------- artifacts ----------

export type ArtifactKind = 'html' | 'json' | 'markdown' | 'yaml' | 'image' | 'text' | 'file'

export interface ArtifactVersion {
  v: number
  ts: number
  size: number
  chatId?: string
  turnId?: string
}

export interface ArtifactInfo {
  name: string
  kind: ArtifactKind
  mime: string
  latest: number
  updatedAt: number
  size: number
  versions: ArtifactVersion[]
}

// ---------- review (no source code) ----------

/**
 * "source": the agent can edit the project and Live candidates hot-reload.
 * "review": the project is not the page's source (e.g. a production site), so the agent
 * leaves notes on the page and temporary page patches instead of editing files.
 */
export type HarnessMode = 'source' | 'review'

export type ReviewSeverity = 'issue' | 'suggestion' | 'info'

/** Who is looking at the harness: the person running it, or a teammate who joined with an invite link. */
export type Access = 'owner' | 'reviewer'

export interface ReviewAuthor {
  /** "agent", "owner" or a reviewer id. */
  id: string
  name: string
  kind: 'agent' | 'human'
}

export interface ReviewPatch {
  /** Inline CSS declarations, e.g. { "font-size": "20px" }. */
  style?: Record<string, string>
  /** Replaces the element's text. */
  text?: string
  /** Image attributes only. */
  attrs?: { src?: string; alt?: string }
  /** Computed values of the styled properties before the change, when the editor recorded them. */
  from?: Record<string, string>
}

/**
 * How the element looked when the change was saved. Kept so a reader can still see the
 * before/after after the element leaves the page. Images are small data URLs.
 */
export interface ReviewLook {
  beforeHtml?: string
  afterHtml?: string
  beforeImage?: string
  afterImage?: string
  /** The page around the element, with the element outlined. */
  beforePage?: string
  afterPage?: string
}

/** What an element looked like when it was annotated; used to find it again after the page changes. */
export interface ReviewAnchor {
  tag: string
  id?: string
  classes?: string[]
  attrs?: Record<string, string>
  /** Start of the element's text, and the text around it in the parent. */
  text?: string
  prefix?: string
  suffix?: string
  /** Viewport width when it was created. */
  vw?: number
}

export interface ReviewReply {
  id: string
  author: ReviewAuthor
  text: string
  at: number
}

export interface ReviewItem {
  id: string
  /** Display number, stable for the item's lifetime. */
  n: number
  kind: 'note' | 'patch'
  /** Site the note belongs to, e.g. `shop.example.com` or `localhost:5173`. */
  host: string
  /** Normalised path (+ search) of the page the item belongs to. */
  path: string
  selector: string
  anchor?: ReviewAnchor
  /** Short description of the element, e.g. `h2 "Plugin 广场"`. */
  label?: string
  note: string
  severity?: ReviewSeverity
  patch?: ReviewPatch
  author: ReviewAuthor
  status: 'open' | 'resolved'
  replies: ReviewReply[]
  chatId?: string
  turnId?: string
  createdAt: number
  /** Appearance captured at save time. Survives when the element is gone. */
  look?: ReviewLook
}

export interface ReviewApproval {
  /** Site the verdict belongs to. Same key as ReviewItem.host. */
  host: string
  path: string
  author: ReviewAuthor
  status: 'approved' | 'changes'
  at: number
}

/** Fields a person sends when adding a note or change from the page. */
export interface ReviewDraft {
  kind: 'note' | 'patch'
  url: string
  /** Site host. The proxy overlay sends the target host; a bookmarklet sends location.host. */
  host?: string
  selector: string
  anchor?: ReviewAnchor
  label?: string
  note: string
  severity?: ReviewSeverity
  patch?: ReviewPatch
  look?: ReviewLook
}

export interface ReviewState {
  items: ReviewItem[]
  approvals: ReviewApproval[]
}

export interface ProbeResult {
  /** Number of elements the selector matches; -1 for an invalid selector. */
  count: number
  url: string
  label?: string
  anchor?: ReviewAnchor
}

export interface Me {
  access: Access
  id: string
  name: string
}

// ---------- page control ----------

export type PageCmd =
  | { action: 'state' }
  | { action: 'click'; index: number; stateId: string }
  | { action: 'input'; index: number; text: string; stateId: string }
  | { action: 'select'; index: number; option: string; stateId: string }
  | { action: 'scroll'; index?: number; pages?: number; down: boolean; stateId?: string }

export interface PageState {
  stateId: string
  url: string
  title: string
  content: string
  truncated: boolean
}

export type PageResult =
  | { ok: true; state?: PageState; message?: string; note?: string }
  | { ok: false; error: string }

export type PageControlStatus = 'online' | 'transferred' | 'paused' | 'offline' | 'disabled' | 'unsupported'

// ---------- WebSocket: panel <-> server ----------

export interface ChatSnapshot {
  chat: ChatMeta
  turns: TurnView[]
  hasMore: boolean
  queue: QueueItem[]
  running: string | null
  pendingAsks: string[]
}

export type ServerMsg =
  | { type: 'hello'; version: number; project: string; target: string; agents: AgentInfo[]; defaultAgent: string; mode: HarnessMode; me: Me; share?: string }
  | { type: 'chats'; chats: ChatMeta[]; active?: string }
  | { type: 'snapshot'; snapshot: ChatSnapshot }
  | { type: 'event'; event: ChatEvent }
  | { type: 'state'; chatId: string; chat: ChatMeta; queue: QueueItem[]; running: string | null }
  | { type: 'artifacts'; artifacts: ArtifactInfo[]; pinned?: string; changed?: string; open?: string }
  | { type: 'notice'; level: 'info' | 'warn'; message: string }
  | { type: 'live'; sessions: LiveSession[] }
  | { type: 'review'; review: ReviewState }
  | { type: 'page_probe'; id: string; selector: string }
  | { type: 'page_cmd'; id: string; cmd: PageCmd }
  | { type: 'page_cancel'; id?: string }
  | { type: 'page_status'; status: PageControlStatus; busy: boolean }
  | { type: 'error'; message: string }

export type ClientMsg =
  | { type: 'subscribe'; chat: string | null; role: 'chat' | 'artifacts' | 'history' }
  | { type: 'focus_chat'; id: string }
  | { type: 'prompt'; message: UserMessage }
  | { type: 'cancel' }
  | { type: 'retry'; turnId: string }
  | { type: 'queue_reorder'; ids: string[] }
  | { type: 'dequeue'; id: string }
  | { type: 'answer'; askId: string; answer: AskAnswer }
  | { type: 'page_control'; on: boolean; attached?: boolean; visible: boolean; tab: string; version: number | null }
  | { type: 'page_visibility'; visible: boolean }
  | { type: 'page_result'; id: string; result: PageResult }
  | { type: 'page_stop' }
  | { type: 'probe_result'; id: string; result: ProbeResult }
  | { type: 'review_remove'; id: string }
  | { type: 'review_add'; draft: ReviewDraft }
  | { type: 'review_look'; id: string; look: ReviewLook }
  | { type: 'review_reply'; id: string; text: string }
  | { type: 'review_edit'; id: string; note: string }
  | { type: 'review_status'; id: string; status: 'open' | 'resolved' }
  | { type: 'review_approve'; url: string; status: 'approved' | 'changes' | null; host?: string }
  | { type: 'set_name'; name: string }
  | { type: 'review_clear'; host?: string }
  | { type: 'review_export' }
  | { type: 'live_op'; request: LiveRequest }
  | { type: 'ping' }

// ---------- postMessage: page <-> panel (over a private MessagePort) ----------

export type PanelRole = 'chat' | 'artifacts'

export interface PageCaps {
  pageControl: number | null
  live: number | null
}

export type ToPanel =
  | { type: 'ph:attach'; tab: string; url: string; title: string; lang: Lang; theme: Theme; caps: PageCaps; visible: boolean }
  | { type: 'ph:pick'; pick: Pick }
  | { type: 'ph:url'; url: string; title: string }
  | { type: 'ph:visibility'; visible: boolean }
  | { type: 'ph:caps'; caps: PageCaps }
  | { type: 'ph:cmd-result'; id: string; result: PageResult }
  | { type: 'ph:live'; request: LiveRequest }
  | { type: 'ph:live-view'; sid: string; current: number; display: LiveDisplay }
  | { type: 'ph:theme'; theme: Theme }
  | { type: 'ph:control-stop' }
  | { type: 'ph:probe-result'; id: string; result: ProbeResult }
  | { type: 'ph:review-remove'; id: string }
  | { type: 'ph:review-add'; draft: ReviewDraft }
  | { type: 'ph:review-look'; id: string; look: ReviewLook }
  | { type: 'ph:review-reply'; id: string; text: string }
  | { type: 'ph:review-edit'; id: string; note: string }
  | { type: 'ph:review-status'; id: string; status: 'open' | 'resolved' }
  | { type: 'ph:review-approve'; url: string; status: 'approved' | 'changes' | null; host?: string }
  | { type: 'ph:review-clear'; host?: string }
  | { type: 'ph:review-export' }

export type ToPage =
  | { type: 'ph:ready'; role: PanelRole }
  | { type: 'ph:theme'; theme: Theme }
  | { type: 'ph:lang'; lang: Lang }
  | { type: 'ph:control'; on: boolean }
  | { type: 'ph:busy'; busy: boolean }
  | { type: 'ph:cmd'; id: string; cmd: PageCmd }
  | { type: 'ph:cmd-cancel'; id?: string }
  | { type: 'ph:live-caps'; on: boolean }
  | { type: 'ph:live-sessions'; sessions: LiveSession[] }
  | { type: 'ph:live-nav'; sid: string; current?: number; display?: LiveDisplay }
  | { type: 'ph:notice'; level: 'ok' | 'warn'; text: string }
  | { type: 'ph:session-dead' }
  | { type: 'ph:open'; what: 'chat' | 'artifacts' | 'close-artifacts' }
  | { type: 'ph:probe'; id: string; selector: string }
  | { type: 'ph:review-items'; review: ReviewState; mode: HarnessMode; me: Me }
