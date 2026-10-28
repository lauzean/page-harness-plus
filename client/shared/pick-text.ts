// 取点内容的纯文本/Markdown 形式：用于“复制”按钮，粘贴到其他 IDE 的对话框里。
import type { Pick } from '@shared/protocol'

/**
 * 把一个取点整理成便于其他 IDE 或 Agent 理解的 Markdown：
 * 页面地址、选择器、标签、可见文字，以及一段 HTML 片段。
 */
export function pickToMarkdown(pick: Pick): string {
  const out = ['Picked element (Page Harness)', `URL: ${pick.url}`, `Selector: ${pick.selector}`, `Tag: ${pick.tagName}`]
  const text = (pick.text ?? '').trim()
  if (text) out.push(`Text: ${text}`)
  const html = (pick.outerHTML ?? '').trim()
  if (html) out.push('', '```html', html, '```')
  return out.join('\n')
}
