/* ── Lightweight Markdown Renderer ─────────────────────────── */
/* Converts a subset of Markdown to HTML. No external dependencies. */

function renderMarkdown(text) {
  if (!text) return '';

  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Split into lines for block-level processing
  const lines = html.split('\n');
  const output = [];
  let inCodeBlock = false;
  let codeBlockContent = [];
  let inList = false;
  let listType = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks (```)
    if (line.match(/^```/)) {
      if (inCodeBlock) {
        output.push(`<pre><code>${codeBlockContent.join('\n')}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      const level = headingMatch[1].length;
      output.push(`<h${level}>${applyInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^(\-{3,}|\*{3,}|_{3,})$/)) {
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      output.push('<hr>');
      continue;
    }

    // Unordered list items
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) output.push(listType === 'ul' ? '</ul>' : '</ol>');
        output.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      output.push(`<li>${applyInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list items
    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) output.push(listType === 'ul' ? '</ul>' : '</ol>');
        output.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      output.push(`<li>${applyInline(olMatch[1])}</li>`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^&gt;\s?(.*)$/);
    if (bqMatch) {
      if (inList) { output.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      output.push(`<blockquote>${applyInline(bqMatch[1])}</blockquote>`);
      continue;
    }

    // Close any open list
    if (inList) {
      output.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }

    // Blank line
    if (line.trim() === '') {
      output.push('');
      continue;
    }

    // Paragraph
    output.push(`<p>${applyInline(line)}</p>`);
  }

  // Close any open blocks
  if (inCodeBlock) {
    output.push(`<pre><code>${codeBlockContent.join('\n')}</code></pre>`);
  }
  if (inList) {
    output.push(listType === 'ul' ? '</ul>' : '</ol>');
  }

  return output.join('\n');
}

/* Apply inline markdown formatting */
function applyInline(text) {
  // Inline code (must be first to prevent other transforms inside it)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Checkboxes
  text = text.replace(/\[x\]/gi, '<input type="checkbox" checked disabled>');
  text = text.replace(/\[ \]/g, '<input type="checkbox" disabled>');

  return text;
}
