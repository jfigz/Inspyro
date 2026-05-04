import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import { createFrontendLogger } from '../../utils/frontendLogger';

const logger = createFrontendLogger('MarkdownRenderer');
let markdownRenderSequence = 0;

const TOKEN_PREFIX = '\u0000INSPYRO_MD_TOKEN_';
const TOKEN_SUFFIX = '_END\u0000';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const createTokenStore = () => {
  const values = [];
  return {
    stash(value) {
      const token = `${TOKEN_PREFIX}${values.length}${TOKEN_SUFFIX}`;
      values.push(String(value || ''));
      return token;
    },
    restore(text) {
      return String(text || '').replace(
        new RegExp(`${TOKEN_PREFIX}(\\d+)${TOKEN_SUFFIX}`, 'g'),
        (match, index) => values[Number(index)] ?? match,
      );
    },
  };
};

const protectFencedCode = (source, tokenStore) => {
  const lines = String(source || '').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const openMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);

    if (!openMatch) {
      output.push(line);
      index += 1;
      continue;
    }

    const fence = openMatch[1];
    const fenceChar = fence[0];
    const fenceLength = fence.length;
    const block = [line];
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index];
      block.push(nextLine);
      const closeMatch = nextLine.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      index += 1;

      if (
        closeMatch
        && closeMatch[1][0] === fenceChar
        && closeMatch[1].length >= fenceLength
      ) {
        break;
      }
    }

    output.push(tokenStore.stash(block.join('\n')));
  }

  return output.join('\n');
};

const protectInlineCode = (source, tokenStore) => String(source || '').replace(
  /(`+)([\s\S]*?)\1/g,
  (match) => tokenStore.stash(match),
);

const normalizeNotebookMathDelimiters = (source) => {
  const tokenStore = createTokenStore();
  const withoutFences = protectFencedCode(source, tokenStore);
  const protectedSource = protectInlineCode(withoutFences, tokenStore);
  const converted = protectedSource
    .replace(/\\\[([\s\S]*?)\\\]/g, (match, body) => `\n$$\n${String(body || '').trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (match, body) => `$${String(body || '').trim()}$`);

  return tokenStore.restore(converted);
};

const buildMarkdownSanitizeConfig = () => ({
  USE_PROFILES: {
    html: true,
    svg: true,
    svgFilters: true,
    mathMl: true,
  },
  ADD_TAGS: [
    'input',
    'annotation',
    'semantics',
    'math',
    'mtext',
    'mn',
    'mo',
    'mi',
    'mrow',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'msqrt',
    'mroot',
    'mtable',
    'mtr',
    'mtd',
    'munder',
    'mover',
    'munderover',
    'mpadded',
    'mspace',
  ],
  ADD_ATTR: [
    'aria-describedby',
    'aria-hidden',
    'aria-label',
    'checked',
    'class',
    'data-footnote-backref',
    'data-footnote-ref',
    'data-footnotes',
    'disabled',
    'display',
    'encoding',
    'fill',
    'focusable',
    'height',
    'href',
    'id',
    'preserveAspectRatio',
    'rel',
    'role',
    'stroke',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-width',
    'style',
    'target',
    'title',
    'transform',
    'type',
    'viewBox',
    'width',
    'x',
    'x1',
    'x2',
    'xmlns',
    'y',
    'y1',
    'y2',
  ],
});

const buildMermaidFallbackHtml = (diagramSource, error) => (
  `<details class="markdown-mermaid-fallback" open>`
  + '<summary>Mermaid no se pudo renderizar</summary>'
  + `<pre class="scroll-surface"><code>${escapeHtml(diagramSource)}</code></pre>`
  + (error ? `<p>${escapeHtml(String(error.message || error))}</p>` : '')
  + '</details>'
);

const renderMermaidDiagrams = async ({
  html,
  diagrams,
  mermaid,
  renderSeed,
  trustHtml,
}) => {
  if (!diagrams.length || typeof document === 'undefined') {
    return html;
  }

  const template = document.createElement('template');
  template.innerHTML = html;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: trustHtml ? 'loose' : 'strict',
    theme: 'dark',
    deterministicIds: false,
  });

  const diagramNodes = Array.from(template.content.querySelectorAll('[data-mermaid-index]'));
  for (const node of diagramNodes) {
    const diagramIndex = Number(node.getAttribute('data-mermaid-index'));
    const diagramSource = diagrams[diagramIndex] || '';
    const diagramId = `inspyro-mermaid-${renderSeed}-${diagramIndex}`;

    try {
      const rendered = await mermaid.render(diagramId, diagramSource);
      node.className = 'markdown-mermaid markdown-mermaid-rendered';
      node.removeAttribute('data-mermaid-index');
      node.innerHTML = rendered?.svg || '';
    } catch (error) {
      logger.warn('Mermaid render failed', error);
      node.className = 'markdown-mermaid markdown-mermaid-error';
      node.removeAttribute('data-mermaid-index');
      node.innerHTML = buildMermaidFallbackHtml(diagramSource, error);
    }
  }

  return template.innerHTML;
};

const executeTrustedScripts = (container) => {
  if (!container || typeof document === 'undefined') {
    return;
  }

  const scripts = Array.from(container.querySelectorAll('script'));
  scripts.forEach((scriptNode) => {
    const executableScript = document.createElement('script');
    Array.from(scriptNode.attributes || []).forEach((attribute) => {
      executableScript.setAttribute(attribute.name, attribute.value);
    });
    executableScript.text = scriptNode.textContent || '';
    scriptNode.replaceWith(executableScript);
  });
};

// Componente para aislar librerías pesadas (marked, katex, mermaid) del bundle inicial.
const MarkdownRenderer = ({ source, onClick, trustHtml = false }) => {
  const [htmlContent, setHtmlContent] = useState('');
  const containerRef = useRef(null);
  const renderSeedRef = useRef(++markdownRenderSequence);

  useEffect(() => {
    let mounted = true;

    const renderAsync = async () => {
      if (!source) {
        if (mounted) {
          setHtmlContent('');
        }
        return;
      }

      try {
        const [
          { Marked, Renderer },
          { default: markedKatex },
          { default: markedFootnote },
          { default: mermaid },
        ] = await Promise.all([
          import('marked'),
          import('marked-katex-extension'),
          import('marked-footnote'),
          import('mermaid'),
        ]);

        const diagrams = [];
        const renderer = new Renderer();
        const defaultCodeRenderer = renderer.code.bind(renderer);
        renderer.code = (code, infostring, escaped) => {
          const language = String(infostring || '').trim().split(/\s+/)[0].toLowerCase();
          if (language === 'mermaid') {
            const diagramIndex = diagrams.push(code) - 1;
            return (
              `<div class="markdown-mermaid markdown-mermaid-pending" data-mermaid-index="${diagramIndex}">`
              + `<pre class="scroll-surface"><code>${escapeHtml(code)}</code></pre>`
              + '</div>'
            );
          }
          return defaultCodeRenderer(code, infostring, escaped);
        };

        const parser = new Marked({
          async: false,
          breaks: true,
          gfm: true,
          mangle: false,
          headerIds: false,
          renderer,
        });
        parser.use(markedKatex({
          throwOnError: false,
          output: 'html',
          nonStandard: true,
        }));
        parser.use(markedFootnote());

        const normalizedSource = normalizeNotebookMathDelimiters(source);
        const rawHtml = parser.parse(normalizedSource);
        const htmlWithMermaid = await renderMermaidDiagrams({
          html: rawHtml,
          diagrams,
          mermaid,
          renderSeed: renderSeedRef.current,
          trustHtml,
        });
        const finalHtml = trustHtml
          ? htmlWithMermaid
          : DOMPurify.sanitize(htmlWithMermaid, buildMarkdownSanitizeConfig());

        if (mounted) {
          setHtmlContent(finalHtml);
        }
      } catch (error) {
        logger.error('Error renderizando markdown:', error);
        if (mounted) {
          setHtmlContent(`<pre class="markdown-render-error scroll-surface">${escapeHtml(source)}</pre>`);
        }
      }
    };

    renderAsync();
    return () => { mounted = false; };
  }, [source, trustHtml]);

  useEffect(() => {
    if (trustHtml) {
      executeTrustedScripts(containerRef.current);
    }
  }, [htmlContent, trustHtml]);

  return (
    <div
      ref={containerRef}
      className={`markdown-content ${trustHtml ? 'markdown-content--trusted' : ''}`}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
      onClick={onClick}
    />
  );
};

export {
  normalizeNotebookMathDelimiters,
};

export default MarkdownRenderer;
