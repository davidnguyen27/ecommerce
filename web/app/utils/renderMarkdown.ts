import MarkdownIt from 'markdown-it'

// `html: false` thoát mọi thẻ HTML trong nội dung, và markdown-it chặn sẵn link `javascript:`,
// nên nội dung nhân viên soạn không chèn được script vào trang khách.
const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(source: string): string {
  return md.render(source)
}
