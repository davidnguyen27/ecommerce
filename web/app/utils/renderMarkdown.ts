import MarkdownIt from 'markdown-it'

// `html: false` escapes every HTML tag in the content, and markdown-it already blocks `javascript:` links, so
// staff-written content cannot inject scripts into customer pages.
const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(source: string): string {
  return md.render(source)
}

/** Plain text of markdown content (syntax removed, link text kept), for meta descriptions. */
export function markdownText(source: string): string {
  return md
    .parse(source, {})
    .filter((token) => token.type === 'inline')
    .map((token) =>
      (token.children ?? [])
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join(''),
    )
    .join(' ')
}
