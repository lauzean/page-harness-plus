import { describe, expect, it } from 'vitest'
import type { Pick } from '@shared/protocol'
import { pickToMarkdown } from './pick-text'

const base: Pick = {
  id: 'p1',
  selector: '#app .card > button.primary',
  tagName: 'BUTTON',
  text: '立即报名',
  outerHTML: '<button class="primary">立即报名</button>',
  url: 'http://localhost:5173/project',
  ts: 1,
}

describe('pickToMarkdown', () => {
  it('includes url, selector, text and an html fence', () => {
    const md = pickToMarkdown(base)
    expect(md).toContain('URL: http://localhost:5173/project')
    expect(md).toContain('Selector: #app .card > button.primary')
    expect(md).toContain('Tag: BUTTON')
    expect(md).toContain('Text: 立即报名')
    expect(md).toContain('```html')
    expect(md).toContain('<button class="primary">立即报名</button>')
  })

  it('omits empty text and html', () => {
    const md = pickToMarkdown({ ...base, text: '  ', outerHTML: '' })
    expect(md).not.toContain('Text:')
    expect(md).not.toContain('```html')
  })
})
