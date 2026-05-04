import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LLM_INDEX_PATH = path.join(REPO_ROOT, 'docs', 'llm-index.yaml');
const OUTPUT_PATH = path.join(REPO_ROOT, 'frontend', 'src', 'contracts', 'wsMessageTypes.generated.js');

const EXACT_MESSAGE_NAMES = new Set([
  'execute_code',
  'ping',
  'pong',
  'error',
  'clear_mdoc',
  'reconvert_pdf',
  'force_reconvert_pdf',
  'mdoc_cleared',
  'json_rpc_lsp',
  'mcp_activity_event',
  'mcp_mirror_event',
  'workspace_fs_event',
]);

const MESSAGE_PREFIXES = [
  'notebook_',
  'template_',
  'execution_',
  'dependency_',
  'impact_',
  'sensitivity_',
  'analyze_',
  'optimize_',
  'optimization_',
  'run_',
  'compare_',
  'load_',
  'code_',
  'scenario_',
  'pdf_',
];

function toConstKey(value) {
  const key = value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(key) ? `MSG_${key}` : key;
}

function isMessageName(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.includes('*')) return false;
  if (!/^[a-z][a-z0-9_]*$/.test(value)) return false;
  if (EXACT_MESSAGE_NAMES.has(value)) return true;
  return MESSAGE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function collectFromContractsSection(text, outSet) {
  const wsSectionMatch = text.match(/websocket_ws:\s*([\s\S]*?)\n\s*websocket_lsp:/m);
  if (!wsSectionMatch) return;
  const wsSection = wsSectionMatch[1];
  const nameRegex = /name:\s*"([^"]+)"/g;
  let match;
  while ((match = nameRegex.exec(wsSection)) !== null) {
    const candidate = match[1];
    if (isMessageName(candidate)) outSet.add(candidate);
  }
}

function collectFromContractsInOut(text, outSet) {
  const arrayRegex = /contracts_(?:in|out):\s*\[([^\]]*)\]/g;
  let arrayMatch;
  while ((arrayMatch = arrayRegex.exec(text)) !== null) {
    const rawList = arrayMatch[1];
    const tokenRegex = /"([^"]+)"/g;
    let tokenMatch;
    while ((tokenMatch = tokenRegex.exec(rawList)) !== null) {
      const candidate = tokenMatch[1];
      if (isMessageName(candidate)) outSet.add(candidate);
    }
  }
}

function buildOutput(messageNames) {
  const sorted = Array.from(messageNames).sort();
  const entries = sorted.map((name) => `  ${toConstKey(name)}: '${name}',`);
  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: docs/llm-index.yaml
// Regenerate: node frontend/scripts/generate_ws_types.mjs

export const WS_MESSAGE_TYPES = Object.freeze({
${entries.join('\n')}
});

export const WS_MESSAGE_LIST = Object.freeze([
${sorted.map((name) => `  '${name}',`).join('\n')}
]);

export const WS_MSG = WS_MESSAGE_TYPES;
`;
}

function main() {
  const llmIndex = fs.readFileSync(LLM_INDEX_PATH, 'utf8');
  const messageNames = new Set();
  collectFromContractsSection(llmIndex, messageNames);
  collectFromContractsInOut(llmIndex, messageNames);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, buildOutput(messageNames), 'utf8');
  console.log(`Generated ${OUTPUT_PATH} (${messageNames.size} message types)`);
}

main();
