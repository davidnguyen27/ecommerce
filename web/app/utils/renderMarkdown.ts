import MarkdownIt from 'markdown-it'

// `html: false` thoát mọi thẻ HTML trong nội dung, và markdown-it chặn sẵn link `javascript:`,
// nên nội dung nhân viên soạn không chèn được script vào trang khách.
const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(source: string): string {
  return md.render(source)
}

/** Chữ thuần của nội dung markdown (bỏ cú pháp, giữ chữ của link), để làm mô tả trong thẻ meta. */
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
