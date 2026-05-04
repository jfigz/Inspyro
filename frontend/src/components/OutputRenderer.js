import React, { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import UnitBadge from './notebook/UnitBadge';
import MarkdownRenderer from './notebook/MarkdownRenderer';
import { splitQuantitiesInText } from './notebook/unitTokens';

// Strip ANSI escape codes from text (used in terminal-colored tracebacks from Jupyter)
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g');
const stripAnsi = (str) => str.replace(ANSI_ESCAPE_RE, '');

const valueToString = (value) => {
  if (Array.isArray(value)) return value.join('');
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeBase64 = (value) => valueToString(value).replace(/\s+/g, '');

const renderImageOutput = (data, mimeType, alt = 'output') => {
  const b64 = normalizeBase64(data[mimeType]);
  if (!b64) return null;
  return (
    <div className="output-media-frame">
      <img
        className="output-image"
        src={`data:${mimeType};base64,${b64}`}
        alt={alt}
      />
    </div>
  );
};

const renderBlockedScript = (payload, mimeType) => (
  <details className="output-blocked-code">
    <summary>{mimeType} bloqueado por seguridad</summary>
    <pre className="output-pre scroll-surface">{valueToString(payload)}</pre>
  </details>
);

const renderUnknownMime = (output, data) => {
  const mimeKeys = Object.keys(data || {});
  return (
    <details className="output-unknown" open>
      <summary>
        Output no especializado{mimeKeys.length ? ` (${mimeKeys.join(', ')})` : ''}
      </summary>
      <pre className="output-pre scroll-surface">{JSON.stringify(output, null, 2)}</pre>
    </details>
  );
};

const renderTextWithUnits = (text, className, keyPrefix = 'unit') => {
  const chunks = splitQuantitiesInText(text);
  const hasQuantities = chunks.some((chunk) => chunk.type === 'quantity');

  if (!hasQuantities) {
    return <pre className={className}>{text}</pre>;
  }

  return (
    <pre className={className}>
      {chunks.map((chunk, index) => {
        if (chunk.type === 'quantity') {
          return (
            <UnitBadge
              key={`${keyPrefix}-${index}`}
              magnitude={chunk.magnitude}
              unit={chunk.unit}
              metadata={chunk.metadata}
              format="inline"
            />
          );
        }
        return <React.Fragment key={`${keyPrefix}-${index}`}>{chunk.value}</React.Fragment>;
      })}
    </pre>
  );
};

// Renderiza un output Jupyter (stream, error, execute_result, display_data)
const OutputRenderer = ({ output, trustHtml = false }) => {
  // Eliminado containerRef no usado en esta rama simple; los renderizadores internos usan sus propios refs

  if (!output) return null;

  // 1) Streams
  if (output.output_type === 'stream') {
    const text = valueToString(output.text);
    return renderTextWithUnits(
      text,
      `output-text ${output.name === 'stderr' ? 'stderr' : 'stdout'}`,
      `stream-${output.name || 'stdout'}`
    );
  }

  // 2) Errores
  if (output.output_type === 'error') {
    const tb = Array.isArray(output.traceback) ? output.traceback.join('\n') : valueToString(output.traceback);
    const summary = [output.ename, output.evalue].filter(Boolean).join(': ') || 'Error de ejecucion';
    const cleanedTraceback = stripAnsi(tb || summary);
    return (
      <details className="output-error-details" open>
        <summary>{stripAnsi(summary)}</summary>
        <pre className="output-error">{cleanedTraceback}</pre>
      </details>
    );
  }

  // 3) Resultados/Display data (mime-bundle)
  const data = output.data || {};

  // Helper: texto plano (con detección de LaTeX delimitado)
  const renderTextPlain = () => {
    const text = valueToString(data['text/plain']);
    const trimmed = text.trim();
    const isInlineDollar = /^\$(.|[\s\S]*?)\$$/.test(trimmed);
    const isBlockDoubleDollar = /^\$\$([\s\S]+)\$\$$/m.test(trimmed);
    const isParenLatex = /^\\\((.|[\s\S]*?)\\\)$/.test(trimmed);
    const isBracketLatex = /^\\\[([\s\S]+)\\\]$/m.test(trimmed);
    if (isInlineDollar || isBlockDoubleDollar || isParenLatex || isBracketLatex) {
      const extract = (s) => s
        .replace(/^\$\$([\s\S]+)\$\$/m, '$1')
        .replace(/^\$([\s\S]+)\$/m, '$1')
        .replace(/^\\\(([\s\S]+)\\\)$/m, '$1')
        .replace(/^\\\[([\s\S]+)\\\]$/m, '$1');
      return <AsyncLatexRenderer latex={extract(trimmed)} />;
    }
    return renderTextWithUnits(text, 'output-textplain', 'textplain');
  };

  // Helper: render LaTeX con KaTeX
  // Nota: el render de LaTeX se realiza en AsyncLatexRenderer

  // raster images (base64)
  if (data['image/png']) {
    return renderImageOutput(data, 'image/png');
  }

  if (data['image/jpeg']) {
    return renderImageOutput(data, 'image/jpeg');
  }

  if (data['image/gif']) {
    return renderImageOutput(data, 'image/gif');
  }

  if (data['image/webp']) {
    return renderImageOutput(data, 'image/webp');
  }

  // image/svg+xml
  if (data['image/svg+xml']) {
    const svg = valueToString(data['image/svg+xml']);
    const sanitizedSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    return (
      <div
        className="output-svg"
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
    );
  }

  // text/html (permitir tablas y atributos; si trustHtml está activo, ampliar aún más)
  if (data['text/html']) {
    const html = valueToString(data['text/html']);
    const baseAllow = {
      ADD_TAGS: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'],
      ADD_ATTR: ['class', 'border', 'align', 'cellpadding', 'cellspacing']
    };
    if (trustHtml) {
      baseAllow.ADD_TAGS = [
        ...baseAllow.ADD_TAGS,
        'span', 'div', 'img', 'svg', 'path', 'p', 'ul', 'ol', 'li', 'hr', 'br', 'a', 'style'
      ];
      baseAllow.ADD_ATTR = [
        ...baseAllow.ADD_ATTR,
        'style', 'href', 'target', 'rel', 'src', 'alt', 'width', 'height', 'viewBox', 'fill', 'stroke', 'd'
      ];
    }
    const sanitized = DOMPurify.sanitize(html, baseAllow);
    return (
      <div
        className="output-html scroll-surface"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }

  // text/latex (normalizar delimitadores $ $, $$ $$, \( \), \[ \])
  if (data['text/latex']) {
    const raw = valueToString(data['text/latex']);
    const normalize = (s) => (
      s
        .trim()
        .replace(/^\$\$([\s\S]+)\$\$/m, '$1')
        .replace(/^\$([\s\S]+)\$/m, '$1')
        .replace(/^\\\(([\s\S]+)\\\)$/m, '$1')
        .replace(/^\\\[([\s\S]+)\\\]$/m, '$1')
    );
    return <AsyncLatexRenderer latex={normalize(raw)} />;
  }

  // application/vnd.plotly.v1+json
  if (data['application/vnd.plotly.v1+json']) {
    const figure = data['application/vnd.plotly.v1+json'];
    return <PlotlyOutput figure={figure} />;
  }

  // application/vnd.vega.v5+json (fallback simple como JSON)
  if (data['application/vnd.vega.v5+json'] || data['application/vnd.vega-lite.v5+json']) {
    const vegaSpec = data['application/vnd.vega.v5+json'] || data['application/vnd.vega-lite.v5+json'];
    return <VegaOutput spec={vegaSpec} />;
  }

  // application/json (genérico)
  if (data['application/json']) {
    return (
      <pre className="output-json output-pre scroll-surface">{JSON.stringify(data['application/json'], null, 2)}</pre>
    );
  }

  if (data['application/pdf']) {
    const b64 = normalizeBase64(data['application/pdf']);
    return (
      <div className="output-pdf">
        <object
          data={`data:application/pdf;base64,${b64}`}
          type="application/pdf"
          aria-label="PDF output"
        >
          PDF output disponible como application/pdf.
        </object>
      </div>
    );
  }

  if (data['text/markdown']) {
    return (
      <div className="output-markdown">
        <MarkdownRenderer source={valueToString(data['text/markdown'])} trustHtml={trustHtml} />
      </div>
    );
  }

  if (data['application/javascript']) {
    return renderBlockedScript(data['application/javascript'], 'application/javascript');
  }

  if (data['text/javascript']) {
    return renderBlockedScript(data['text/javascript'], 'text/javascript');
  }

  // ipywidgets (placeholder; requiere comms bidireccionales)
  if (data['application/vnd.jupyter.widget-view+json']) {
    const payload = data['application/vnd.jupyter.widget-view+json'];
    return <WidgetPlaceholder view={payload} />;
  }

  // text/plain por defecto
  if (data['text/plain']) {
    return renderTextPlain();
  }

  // Fallback
  return renderUnknownMime(output, data);
};

export default OutputRenderer;

function AsyncLatexRenderer({ latex }) {
  const containerRef = useRef(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const katex = (await import('katex')).default;
        const html = katex.renderToString(latex, { throwOnError: false, output: 'html' });
        if (mounted && containerRef.current) {
          containerRef.current.innerHTML = html;
        }
      } catch (e) {
        if (containerRef.current) {
          containerRef.current.innerText = '[Error LaTeX] ' + String(e);
        }
      }
    })();
    return () => { mounted = false; };
  }, [latex]);
  return <div className="output-latex" ref={containerRef} />;
}

function VegaOutput({ spec }) {
  const containerRef = useRef(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const vegaEmbed = (await import('vega-embed')).default;
        if (mounted && containerRef.current) {
          await vegaEmbed(containerRef.current, spec, { actions: false });
        }
      } catch (e) {
        if (containerRef.current) {
          containerRef.current.innerText = '[Error Vega/Vega-Lite] ' + String(e);
        }
      }
    })();
    return () => { mounted = false; };
  }, [spec]);
  return <div className="output-vega" ref={containerRef} />;
}
const PlotlyOutput = ({ figure }) => {
  const containerRef = useRef(null);
  useEffect(() => {
    let isMounted = true;
    const render = async () => {
      try {
        const Plotly = (await import('plotly.js-dist-min')).default;
        if (isMounted && containerRef.current) {
          const { data: figData = [], layout = {}, config = {} } = figure || {};
          await Plotly.newPlot(containerRef.current, figData, layout, {
            responsive: true,
            displaylogo: false,
            ...config,
          });
        }
      } catch (e) {
        if (containerRef.current) {
          containerRef.current.innerText = '[Error renderizando Plotly] ' + String(e);
        }
      }
    };
    render();
    return () => { isMounted = false; };
  }, [figure]);
  return <div className="output-plotly" ref={containerRef} />;
};

function WidgetPlaceholder({ view }) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'output-pre scroll-surface';
    pre.textContent = 'Widget Jupyter no interactivo: ' + JSON.stringify(view);
    containerRef.current.appendChild(pre);
  }, [view]);
  return <div className="output-widget" ref={containerRef} />;
}
