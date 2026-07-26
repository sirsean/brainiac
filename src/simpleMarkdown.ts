/** Very small Markdown → React-ish HTML for therapy reports (headings, lists, bold, paragraphs). */
export function renderSimpleMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const lines = escaped.split(/\r?\n/)
  const out: string[] = []
  let inUl = false
  let inOl = false

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }

  const inline = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      closeLists()
      out.push(`<h2 class="mt-4 mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">${inline(h2[1])}</h2>`)
      continue
    }
    const h3 = line.match(/^###\s+(.+)$/)
    if (h3) {
      closeLists()
      out.push(`<h3 class="mt-3 mb-1 text-xs font-semibold uppercase tracking-[0.15em] text-amber-200/90">${inline(h3[1])}</h3>`)
      continue
    }
    const ul = line.match(/^[-*]\s+(.+)$/)
    if (ul) {
      if (inOl) {
        out.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        out.push('<ul class="mb-2 list-disc space-y-1 pl-5 text-sm text-amber-100/90">')
        inUl = true
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      if (inUl) {
        out.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        out.push('<ol class="mb-2 list-decimal space-y-1 pl-5 text-sm text-amber-100/90">')
        inOl = true
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    if (!line.trim()) {
      closeLists()
      continue
    }
    closeLists()
    out.push(`<p class="mb-2 text-sm leading-relaxed text-amber-100/90">${inline(line)}</p>`)
  }
  closeLists()
  return out.join('\n')
}
