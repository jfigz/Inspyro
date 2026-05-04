/**
 * deriveEngineeringVars.js
 *
 * Pure-function extraction from NotebookEditor.js.
 * Parses cell outputs (HTML DataFrames, ASCII tables, NumPy arrays)
 * into structured engineering variables for the VisualizationPanel.
 *
 * No React dependencies — this is a plain utility module.
 */

// ────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────

function parseAsciiDataFrame(text) {
    const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const headerTokens = lines[0].split(/\s{2,}|\t|\s+/).filter(Boolean);
    const second = lines[1].split(/\s{2,}|\t|\s+/).filter(Boolean);
    if (headerTokens.length >= 1 && second.length === headerTokens.length + 1) {
        const headers = headerTokens;
        const rows = lines.slice(1).map(rowLine => {
            const toks = rowLine.split(/\s{2,}|\t|\s+/).filter(Boolean);
            const obj = {};
            headers.forEach((h, i) => {
                const raw = toks[i + 1];
                const num = Number(raw);
                obj[h] = raw !== '' && !Number.isNaN(num) ? num : raw;
            });
            return obj;
        });
        return { headers, rows };
    }
    return null;
}

function parseArray(text) {
    const match = (text || '').match(/\[\s*(?:\[.*?\]|[^\]]*?)\s*\]/s);
    if (!match) return null;
    const raw = match[0].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    try {
        if (/^\[\s*\[/.test(raw)) {
            // 2D
            const rows = raw.match(/\[(.*?)\]/g) || [];
            const data2d = rows.map(r =>
                r.replace(/\[/g, '').replace(/\]/g, '').trim()
                    .split(/\s*,\s*|\s+/).filter(Boolean).map(Number)
            );
            const shape = [data2d.length, (data2d[0] || []).length];
            return { ndim: 2, shape, data: data2d };
        } else {
            // 1D
            const data1d = raw.replace(/\[/g, '').replace(/\]/g, '').trim()
                .split(/\s*,\s*|\s+/).filter(Boolean).map(Number);
            return { ndim: 1, shape: [data1d.length], data: data1d };
        }
    } catch {
        return null;
    }
}

// ────────────────────────────────────────
// Build a DataFrame variable descriptor
// ────────────────────────────────────────

function buildDataFrame(varName, subtype, headers, rows) {
    return {
        [varName]: {
            type: 'DataFrame',
            subtype,
            columns: headers,
            data: rows,
            dtypes: {},
            shape: [rows.length, headers.length],
            repr: `DataFrame[${rows.length} filas × ${headers.length} columnas]`,
            value: `DataFrame (${rows.length}×${headers.length})`,
            is_engineering_data: true,
        },
    };
}

function buildNdArray(varName, arr) {
    return {
        [varName]: {
            type: 'ndarray',
            subtype: 'numpy',
            shape: arr.shape,
            dtype: 'float64',
            size: arr.ndim === 2 ? arr.shape[0] * arr.shape[1] : arr.shape[0],
            ndim: arr.ndim,
            data: arr.data,
            repr: `Array${JSON.stringify(arr.shape)} dtype=float64`,
            value: `Array ${JSON.stringify(arr.shape)}`,
            memory_usage: 0,
            is_engineering_data: true,
        },
    };
}

function normalizeQuantityVariable(variable) {
    if (!variable || typeof variable !== 'object') return null;

    const isQuantity = variable.type === 'Quantity' || variable.is_quantity === true;
    if (!isQuantity) return null;

    const unit = variable.unit_display || variable.unit || variable.unit_canonical || variable.unit_full || '';
    const magnitude = Object.prototype.hasOwnProperty.call(variable, 'magnitude')
        ? variable.magnitude
        : null;
    const repr = variable.repr || `${magnitude ?? ''} ${unit}`.trim();

    return {
        type: 'Quantity',
        magnitude,
        unit,
        unit_display: variable.unit_display || unit,
        unit_canonical: variable.unit_canonical || unit,
        unit_pint: variable.unit_pint || variable.unit_full || unit,
        aliases: Array.isArray(variable.aliases) ? variable.aliases : [],
        unit_full: variable.unit_full || unit,
        unit_latex: variable.unit_latex || null,
        unit_html: variable.unit_html || null,
        dimensionality: variable.dimensionality || null,
        category: variable.category || variable.metadata?.category || 'Otra',
        metadata: variable.metadata || null,
        repr,
        value: repr,
        is_quantity: true,
        is_engineering_data: true,
    };
}

// ────────────────────────────────────────
// Public API
// ────────────────────────────────────────

/**
 * Derive structured engineering variables from cell outputs.
 *
 * @param {Array} outputs – Jupyter-style cell outputs
 * @param {string} cellId – The cell identifier (used for variable naming)
 * @param {Object} baseVariables - Backend variables_summary map (optional)
 * @returns {Object} Map of variable names to descriptors
 */
export function deriveEngineeringVarsFromOutputs(outputs, cellId, baseVariables = null) {
    const engineered = {};

    if (baseVariables && typeof baseVariables === 'object') {
        Object.entries(baseVariables).forEach(([name, variable]) => {
            const normalized = normalizeQuantityVariable(variable);
            if (normalized) {
                engineered[name] = normalized;
            }
        });
    }

    if (!Array.isArray(outputs)) return engineered;

    for (const out of outputs) {
        if (!out) continue;

        // 1) display_data / execute_result
        if (out.output_type === 'display_data' || out.output_type === 'execute_result') {
            const data = out.data || {};
            const html = Array.isArray(data['text/html'])
                ? data['text/html'].join('')
                : data['text/html'];

            if (typeof html === 'string' && html.includes('class="dataframe"')) {
                try {
                    const container = document.createElement('div');
                    container.innerHTML = html;
                    const theadCells = container.querySelectorAll('thead th');
                    let headers = Array.from(theadCells).map(th => (th.textContent || '').trim());
                    if (headers.length > 0 && headers[0] === '') headers = headers.slice(1);
                    const bodyRows = container.querySelectorAll('tbody tr');
                    const rows = Array.from(bodyRows).map(tr => {
                        const tds = tr.querySelectorAll('td');
                        const values = Array.from(tds).map(td => (td.textContent || '').trim());
                        const obj = {};
                        headers.forEach((h, i) => {
                            const raw = values[i];
                            const num = Number(raw);
                            obj[h] = raw !== '' && !Number.isNaN(num) ? num : raw;
                        });
                        return obj;
                    });
                    if (headers.length > 0 && rows.length > 0) {
                        const varName = `__out_df_${cellId || 'cell'}__`;
                        Object.assign(engineered, buildDataFrame(varName, 'pandas', headers, rows));
                        continue;
                    }
                } catch { /* noop */ }
            }

            const txt = Array.isArray(data['text/plain'])
                ? data['text/plain'].join('')
                : data['text/plain'];
            if (typeof txt === 'string') {
                const df = parseAsciiDataFrame(txt);
                if (df) {
                    Object.assign(engineered, buildDataFrame(`__out_df_${cellId || 'cell'}__`, 'ascii', df.headers, df.rows));
                } else {
                    const arr = parseArray(txt);
                    if (arr) {
                        Object.assign(engineered, buildNdArray(`__out_arr_${cellId || 'cell'}__`, arr));
                    }
                }
            }
        }

        // 2) stream stdout
        if (out.output_type === 'stream' && (out.name || 'stdout') === 'stdout') {
            const text = Array.isArray(out.text) ? out.text.join('') : (out.text || '');
            const df = parseAsciiDataFrame(text);
            if (df) {
                Object.assign(engineered, buildDataFrame(`__stream_df_${cellId || 'cell'}__`, 'ascii', df.headers, df.rows));
                continue;
            }
            const arr = parseArray(text);
            if (arr) {
                Object.assign(engineered, buildNdArray(`__stream_arr_${cellId || 'cell'}__`, arr));
            }
        }
    }

    return engineered;
}
