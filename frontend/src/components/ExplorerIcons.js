import React from 'react';

const extensionKindMap = {
  '.py': 'python',
  '.pyi': 'python',
  '.ipynb': 'notebook',
  '.js': 'javascript',
  '.jsx': 'react',
  '.ts': 'typescript',
  '.tsx': 'react',
  '.json': 'json',
  '.md': 'markdown',
  '.txt': 'text',
  '.csv': 'data',
  '.tsv': 'data',
  '.yml': 'config',
  '.yaml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.cfg': 'config',
  '.conf': 'config',
  '.html': 'markup',
  '.xml': 'markup',
  '.svg': 'markup',
  '.css': 'style',
  '.scss': 'style',
  '.less': 'style',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.env': 'env',
  '.log': 'log',
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
};

const iconBaseProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 20 20',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': 'true',
};

const actionBaseProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': 'true',
};

const softIconTones = {
  python: { fill: '#4d7592', stroke: '#8eb0c6', accent: '#a9c5d6', secondary: '#c7a46a' },
  notebook: { fill: '#8b6a42', stroke: '#c7a371', accent: '#e0b579', secondary: '#9db4c8' },
  powershell: { fill: '#3f6b86', stroke: '#7fb2cd', accent: '#a9d1e4', secondary: '#6aa0bd' },
  shell: { fill: '#476f59', stroke: '#86b99a', accent: '#b1d2bd', secondary: '#789f88' },
  json: { fill: '#6b6682', stroke: '#aaa5bd', accent: '#c3bdcf', secondary: '#8f8aa5' },
  markdown: { fill: '#497878', stroke: '#85b9b5', accent: '#add5d0', secondary: '#6da29f' },
  markup: { fill: '#8a685e', stroke: '#c0a197', accent: '#dcc2b9', secondary: '#a77f73' },
  style: { fill: '#52789d', stroke: '#92b5d3', accent: '#b7d2e8', secondary: '#7da1c0' },
  config: { fill: '#74618d', stroke: '#aa9abe', accent: '#d0c1de', secondary: '#9081a5' },
  data: { fill: '#447b70', stroke: '#83b9ae', accent: '#acd7ce', secondary: '#70a59a' },
  javascript: { fill: '#8a7a45', stroke: '#c5b174', accent: '#dcc987', secondary: '#a99555' },
  typescript: { fill: '#4f729d', stroke: '#8eaccd', accent: '#b4cce2', secondary: '#7195bd' },
  react: { fill: '#4d7d86', stroke: '#8cbac3', accent: '#b5d8de', secondary: '#78a9b2' },
  text: { fill: '#636b76', stroke: '#a4adba', accent: '#c9d0da', secondary: '#8c96a4' },
  docx: { fill: '#526f9a', stroke: '#91abc9', accent: '#b9cce0', secondary: '#728eb3' },
  pdf: { fill: '#8b5d59', stroke: '#c19791', accent: '#ddb8b2', secondary: '#a87770' },
  image: { fill: '#47786f', stroke: '#87b8ae', accent: '#b2d6ce', secondary: '#c8b46d' },
  log: { fill: '#7d6953', stroke: '#b6a089', accent: '#d6c1aa', secondary: '#a58d74' },
  env: { fill: '#687549', stroke: '#aab889', accent: '#ccd6ad', secondary: '#889767' },
  generic: { fill: '#626b78', stroke: '#a1acbb', accent: '#c4cdda', secondary: '#8994a4' },
};

const IconCanvas = ({ children, className = 'explorer-svg-icon explorer-svg-icon--file' }) => (
  <svg {...iconBaseProps} className={className}>
    {children}
  </svg>
);

const SoftFileCanvas = ({ tone, children }) => (
  <IconCanvas>
    <path
      d="M5.35 2.55h5.75l3.55 3.55v8.55a2 2 0 0 1-2 2h-7.3a2 2 0 0 1-2-2V4.55a2 2 0 0 1 2-2Z"
      fill={tone.fill}
      fillOpacity="0.18"
    />
    <path
      d="M11.1 2.55v2.55a1 1 0 0 0 1 1h2.55"
      fill={tone.accent}
      fillOpacity="0.18"
    />
    <path
      d="M5.35 2.55h5.75l3.55 3.55v8.55a2 2 0 0 1-2 2h-7.3a2 2 0 0 1-2-2V4.55a2 2 0 0 1 2-2Z"
      stroke={tone.stroke}
      strokeOpacity="0.74"
      strokeWidth="1.02"
      strokeLinejoin="round"
    />
    {children}
  </IconCanvas>
);

const IconStroke = ({ tone, children, width = 1.18, opacity = 0.84 }) => (
  <g
    fill="none"
    stroke={tone.accent}
    strokeOpacity={opacity}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </g>
);

const SoftFolderCanvas = ({ open = false }) => {
  const tone = open
    ? { fill: '#9f7e45', stroke: '#c4a46d', accent: '#e2c78d' }
    : { fill: '#8f7444', stroke: '#b69967', accent: '#d8bf86' };

  return (
    <IconCanvas className="explorer-svg-icon explorer-svg-icon--folder">
      <path
        d="M2.55 5.35a1.75 1.75 0 0 1 1.75-1.75h3.05l1.28 1.35h6.82a1.75 1.75 0 0 1 1.75 1.75v.75H2.55v-2.1Z"
        fill={tone.fill}
        fillOpacity={open ? '0.2' : '0.16'}
      />
      <path
        d="M2.45 7.15h15.1l-1.02 6.35a2.05 2.05 0 0 1-2.02 1.72H4.9a2.05 2.05 0 0 1-2.03-1.78L2.45 7.15Z"
        fill={tone.fill}
        fillOpacity={open ? '0.26' : '0.2'}
      />
      <path
        d="M4.9 8.85h9.7"
        stroke={tone.accent}
        strokeOpacity="0.58"
        strokeWidth="1.08"
        strokeLinecap="round"
      />
      <path
        d="M2.55 7.45v-2.1a1.75 1.75 0 0 1 1.75-1.75h3.05l1.28 1.35h6.82a1.75 1.75 0 0 1 1.75 1.75v.75M2.45 7.15h15.1l-1.02 6.35a2.05 2.05 0 0 1-2.02 1.72H4.9a2.05 2.05 0 0 1-2.03-1.78L2.45 7.15Z"
        stroke={tone.stroke}
        strokeOpacity="0.78"
        strokeWidth="1.05"
        strokeLinejoin="round"
      />
    </IconCanvas>
  );
};

const FolderIcon = ({ open = false }) => <SoftFolderCanvas open={open} />;

const PythonFileIcon = () => {
  const tone = softIconTones.python;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone}>
        <path d="M7.25 8.15c0-1.15.82-1.75 2.15-1.75h1.5" />
        <path d="M12.75 11.85c0 1.15-.82 1.75-2.15 1.75H9.1" />
        <path d="m7.3 10 1.45-1.45" />
        <path d="m12.7 10-1.45 1.45" />
      </IconStroke>
      <circle cx="8.25" cy="7.35" r="0.45" fill={tone.secondary} fillOpacity="0.72" />
      <circle cx="11.75" cy="12.65" r="0.45" fill={tone.secondary} fillOpacity="0.72" />
    </SoftFileCanvas>
  );
};

const NotebookFileIcon = () => {
  const tone = softIconTones.notebook;
  return (
    <SoftFileCanvas tone={tone}>
      <rect x="6.15" y="6.65" width="7.35" height="2.35" rx="0.75" fill={tone.fill} fillOpacity="0.22" />
      <rect x="6.15" y="10.45" width="7.35" height="2.35" rx="0.75" fill={tone.fill} fillOpacity="0.18" />
      <IconStroke tone={tone}>
        <path d="M7.35 7.85h4.95" />
        <path d="M7.35 11.65h4.95" />
      </IconStroke>
      <path d="M5.55 6.3v6.75" stroke={tone.secondary} strokeOpacity="0.58" strokeWidth="1.05" strokeLinecap="round" />
    </SoftFileCanvas>
  );
};

const PowerShellFileIcon = () => {
  const tone = softIconTones.powershell;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.35}>
        <path d="m6.55 8.2 2.15 1.55-2.15 1.55" />
        <path d="M9.95 12.25h2.75" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const ShellFileIcon = () => {
  const tone = softIconTones.shell;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.35}>
        <path d="m6.3 8.2 2.15 1.55-2.15 1.55" />
        <path d="M9.55 12.25h3.2" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const JsonFileIcon = () => {
  const tone = softIconTones.json;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.2}>
        <path d="M7.8 7.15c-1.05 0-1.5.5-1.5 1.35v.65c0 .55-.25.85-.75.85.5 0 .75.3.75.85v.65c0 .85.45 1.35 1.5 1.35" />
        <path d="M12.2 7.15c1.05 0 1.5.5 1.5 1.35v.65c0 .55.25.85.75.85-.5 0-.75.3-.75.85v.65c0 .85-.45 1.35-1.5 1.35" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const MarkdownFileIcon = () => {
  const tone = softIconTones.markdown;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone}>
        <path d="M6.15 12.6V7.55l1.9 2.35 1.9-2.35v5.05" />
        <path d="M11.2 8.05h2.65" />
        <path d="m12.5 8.05v4.55" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const MarkupFileIcon = () => {
  const tone = softIconTones.markup;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone}>
        <path d="m8 7.45-2.35 2.55L8 12.55" />
        <path d="m12 7.45 2.35 2.55L12 12.55" />
        <path d="m10.8 7.15-1.6 5.7" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const StyleFileIcon = () => {
  const tone = softIconTones.style;
  return (
    <SoftFileCanvas tone={tone}>
      <path d="M7 12.95c2.95-1.9 4.4-4.08 4.95-6.25 1.1 1.25 1.6 2.45 1.6 3.7 0 2.1-1.55 3.35-3.55 3.35-1.1 0-2.1-.28-3-.8Z" fill={tone.fill} fillOpacity="0.24" />
      <IconStroke tone={tone}>
        <path d="M7 12.95c2.95-1.9 4.4-4.08 4.95-6.25" />
        <path d="M7.15 9.25c-1.1.72-1.65 1.55-1.65 2.5 0 1.28 1.05 2 2.45 2" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const ConfigFileIcon = () => {
  const tone = softIconTones.config;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone}>
        <path d="M6.25 7.55h7.5" />
        <path d="M6.25 10h7.5" />
        <path d="M6.25 12.45h7.5" />
      </IconStroke>
      <circle cx="8.15" cy="7.55" r="0.82" fill={tone.secondary} fillOpacity="0.52" />
      <circle cx="11.85" cy="10" r="0.82" fill={tone.secondary} fillOpacity="0.52" />
      <circle cx="9.45" cy="12.45" r="0.82" fill={tone.secondary} fillOpacity="0.52" />
    </SoftFileCanvas>
  );
};

const DataFileIcon = () => {
  const tone = softIconTones.data;
  return (
    <SoftFileCanvas tone={tone}>
      <path d="M6.15 7.4h7.7v5.6h-7.7V7.4Z" fill={tone.fill} fillOpacity="0.16" />
      <IconStroke tone={tone} width={1.02}>
        <path d="M6.15 7.4h7.7v5.6h-7.7V7.4Z" />
        <path d="M6.15 9.25h7.7" />
        <path d="M6.15 11.1h7.7" />
        <path d="M8.7 7.4V13" />
        <path d="M11.25 7.4V13" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const JavaScriptFileIcon = () => {
  const tone = softIconTones.javascript;
  return (
    <SoftFileCanvas tone={tone}>
      <path d="M6.25 7.35h7.5v5.65h-7.5V7.35Z" fill={tone.fill} fillOpacity="0.18" />
      <IconStroke tone={tone}>
        <path d="M8.8 8.5v2.85c0 .85-.48 1.35-1.35 1.35" />
        <path d="M12.55 8.75c-.5-.28-1.65-.5-2.05.12-.72 1.1 2.25 1.02 1.8 2.65-.24.86-1.55 1.08-2.55.6" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const TypeScriptFileIcon = () => {
  const tone = softIconTones.typescript;
  return (
    <SoftFileCanvas tone={tone}>
      <path d="M6.25 7.35h7.5v5.65h-7.5V7.35Z" fill={tone.fill} fillOpacity="0.18" />
      <IconStroke tone={tone}>
        <path d="M7.25 8.5h3.05" />
        <path d="M8.78 8.5v4" />
        <path d="M12.7 8.75c-.5-.28-1.65-.5-2.05.12-.72 1.1 2.25 1.02 1.8 2.65-.24.86-1.55 1.08-2.55.6" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const ReactFileIcon = () => {
  const tone = softIconTones.react;
  return (
    <SoftFileCanvas tone={tone}>
      <circle cx="10" cy="10" r="0.78" fill={tone.accent} fillOpacity="0.72" />
      <IconStroke tone={tone} width={0.98}>
        <ellipse cx="10" cy="10" rx="4.1" ry="1.55" />
        <ellipse cx="10" cy="10" rx="4.1" ry="1.55" transform="rotate(60 10 10)" />
        <ellipse cx="10" cy="10" rx="4.1" ry="1.55" transform="rotate(120 10 10)" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const TextFileIcon = () => {
  const tone = softIconTones.text;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.05}>
        <path d="M6.2 7.45h7.1" />
        <path d="M6.2 9.55h6.1" />
        <path d="M6.2 11.65h7.1" />
        <path d="M6.2 13.75h4.55" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const DocxFileIcon = () => {
  const tone = softIconTones.docx;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.05}>
        <path d="M6.25 7.35h7.05" />
        <path d="M6.25 9.45h5.95" />
        <path d="M6.25 11.55h7.05" />
        <path d="M6.25 13.65h4.55" />
      </IconStroke>
      <path d="M5.35 6.7v7.25" stroke={tone.secondary} strokeOpacity="0.58" strokeWidth="1.05" strokeLinecap="round" />
    </SoftFileCanvas>
  );
};

const PdfFileIcon = () => {
  const tone = softIconTones.pdf;
  return (
    <SoftFileCanvas tone={tone}>
      <path d="M6.15 6.85h7.7v2.55h-7.7V6.85Z" fill={tone.fill} fillOpacity="0.22" />
      <IconStroke tone={tone} width={1.05}>
        <path d="M6.6 12.95c.5-1.7 1.28-3.82 2.15-5.65.5 2.5 1.65 4.72 3.3 5.32.82.3 1.48.05 1.7-.45.3-.72-.55-1.25-1.65-.92-1.55.45-3.55.92-5.5 1.7Z" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const ImageFileIcon = () => {
  const tone = softIconTones.image;
  return (
    <SoftFileCanvas tone={tone}>
      <rect x="5.65" y="6.65" width="8.7" height="6.75" rx="1.2" fill={tone.fill} fillOpacity="0.14" />
      <IconStroke tone={tone} width={1.05}>
        <path d="M5.65 13.4 8 10.95l1.85 1.55 1.8-2.05 2.7 2.95" />
        <path d="M5.65 6.65h8.7v6.75h-8.7V6.65Z" />
      </IconStroke>
      <circle cx="12.3" cy="8.35" r="0.78" fill={tone.secondary} fillOpacity="0.62" />
    </SoftFileCanvas>
  );
};

const LogFileIcon = () => {
  const tone = softIconTones.log;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.05}>
        <path d="M8.25 7.45h4.6" />
        <path d="M8.25 10h4.6" />
        <path d="M8.25 12.55h3.8" />
      </IconStroke>
      <path d="M6.25 7.45h0M6.25 10h0M6.25 12.55h0" stroke={tone.secondary} strokeOpacity="0.66" strokeWidth="2.2" strokeLinecap="round" />
    </SoftFileCanvas>
  );
};

const EnvFileIcon = () => {
  const tone = softIconTones.env;
  return (
    <SoftFileCanvas tone={tone}>
      <path d="M6.05 9.85a3.95 3.95 0 0 1 7.9 0v1.1a3.95 3.95 0 0 1-7.9 0v-1.1Z" fill={tone.fill} fillOpacity="0.18" />
      <IconStroke tone={tone}>
        <path d="M6.25 10.4h7.5" />
        <path d="M8.1 8.2c.68 1.55.68 2.85 0 4.4" />
        <path d="M11.9 8.2c-.68 1.55-.68 2.85 0 4.4" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const GenericFileIcon = () => {
  const tone = softIconTones.generic;
  return (
    <SoftFileCanvas tone={tone}>
      <IconStroke tone={tone} width={1.05}>
        <path d="M6.2 8.2h6.9" />
        <path d="M6.2 10.45h6.9" />
        <path d="M6.2 12.7h4.8" />
      </IconStroke>
    </SoftFileCanvas>
  );
};

const FILE_ICON_COMPONENTS = {
  python: PythonFileIcon,
  notebook: NotebookFileIcon,
  powershell: PowerShellFileIcon,
  shell: ShellFileIcon,
  json: JsonFileIcon,
  markdown: MarkdownFileIcon,
  markup: MarkupFileIcon,
  style: StyleFileIcon,
  config: ConfigFileIcon,
  data: DataFileIcon,
  javascript: JavaScriptFileIcon,
  typescript: TypeScriptFileIcon,
  react: ReactFileIcon,
  text: TextFileIcon,
  docx: DocxFileIcon,
  pdf: PdfFileIcon,
  image: ImageFileIcon,
  log: LogFileIcon,
  env: EnvFileIcon,
  generic: GenericFileIcon,
};

export const ExplorerFileIcon = ({ extension = '', isDirectory = false, isOpen = false }) => {
  if (isDirectory) {
    return <FolderIcon open={isOpen} />;
  }

  const kind = extensionKindMap[(extension || '').toLowerCase()] || 'generic';
  const IconComponent = FILE_ICON_COMPONENTS[kind] || GenericFileIcon;
  return <IconComponent />;
};

const ActionStroke = ({ children, ...props }) => (
  <svg
    {...actionBaseProps}
    {...props}
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const ExplorerIconSidebar = () => (
  <ActionStroke>
    <rect x="2" y="2.5" width="12" height="11" rx="2.2" />
    <path d="M6 2.5v11" />
  </ActionStroke>
);

export const ExplorerIconNotebookIndex = () => (
  <ActionStroke>
    <path d="M3 3.5h10" />
    <path d="M3 6.5h7.5" />
    <path d="M3 9.5h10" />
    <path d="M3 12.5h6" />
    <path d="M12.2 11.1 14 12.9" />
    <path d="M14 11.1 12.2 12.9" />
  </ActionStroke>
);

export const ExplorerIconFilePlus = () => (
  <ActionStroke>
    <path d="M5 2.5h4.6L12 5v7.1a1.9 1.9 0 0 1-1.9 1.9H5A1.9 1.9 0 0 1 3.1 12V4.4A1.9 1.9 0 0 1 5 2.5Z" />
    <path d="M9.6 2.5V5H12" />
    <path d="M13 8.8h-3.2" />
    <path d="M11.4 7.2v3.2" />
  </ActionStroke>
);

export const ExplorerIconFolderPlus = () => (
  <ActionStroke>
    <path d="M2.4 5.3a1.7 1.7 0 0 1 1.7-1.7h2.7l1.2 1.3h4.1a1.7 1.7 0 0 1 1.7 1.7v.6H2.4v-1.9Z" />
    <path d="M2.4 7.1h11.3a1.5 1.5 0 0 1 1.45 1.9l-.75 2.9a1.8 1.8 0 0 1-1.75 1.35H4.2a1.8 1.8 0 0 1-1.76-1.43L1.8 9a1.5 1.5 0 0 1 .6-1.58Z" />
    <path d="M9.9 8.8h3.2" />
    <path d="M11.5 7.2v3.2" />
  </ActionStroke>
);

export const ExplorerIconEdit = () => (
  <ActionStroke>
    <path d="M3.1 11.8 11 3.9a1.4 1.4 0 0 1 2 0l.9.9a1.4 1.4 0 0 1 0 2l-7.9 7.9-2.9.7.7-2.6Z" />
    <path d="M10.5 4.4 13.4 7.3" />
  </ActionStroke>
);

export const ExplorerIconTrash = () => (
  <ActionStroke>
    <path d="M2.8 4.4h10.4" />
    <path d="M4.5 4.4v7.1A1.7 1.7 0 0 0 6.2 13.2h3.6a1.7 1.7 0 0 0 1.7-1.7V4.4" />
    <path d="M5.6 4.4V3.2A1.2 1.2 0 0 1 6.8 2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.2" />
  </ActionStroke>
);

export const ExplorerIconReveal = () => (
  <ActionStroke>
    <path d="M1.8 8s2.2-3.4 6.2-3.4S14.2 8 14.2 8s-2.2 3.4-6.2 3.4S1.8 8 1.8 8Z" />
    <circle cx="8" cy="8" r="1.8" />
  </ActionStroke>
);

export const ExplorerIconEye = () => (
  <ActionStroke>
    <path d="M1.8 8s2.2-3.4 6.2-3.4S14.2 8 14.2 8s-2.2 3.4-6.2 3.4S1.8 8 1.8 8Z" />
    <circle cx="8" cy="8" r="1.8" />
  </ActionStroke>
);

export const ExplorerIconEyeOff = () => (
  <ActionStroke>
    <path d="M2.2 2.2 13.8 13.8" />
    <path d="M6.4 4.8A7.6 7.6 0 0 1 8 4.6c4 0 6.2 3.4 6.2 3.4a12.3 12.3 0 0 1-2.3 2.55" />
    <path d="M9.6 11.2A4.6 4.6 0 0 1 8 11.4c-4 0-6.2-3.4-6.2-3.4A12.4 12.4 0 0 1 4.1 5.4" />
  </ActionStroke>
);

export const ExplorerIconRefresh = () => (
  <ActionStroke>
    <path d="M12.8 5.2V2.8H10.4" />
    <path d="M12.5 8a4.5 4.5 0 1 1-1.2-3.1l1.5 1.5" />
  </ActionStroke>
);

export const ExplorerIconChevronRight = ({ className = '' }) => (
  <ActionStroke className={className}>
    <path d="m6 3.4 4 4.6L6 12.6" />
  </ActionStroke>
);

export const ExplorerIconChevronLeft = () => (
  <ActionStroke>
    <path d="m10 3.4-4 4.6 4 4.6" />
  </ActionStroke>
);

export const ExplorerIconClose = () => (
  <ActionStroke>
    <path d="M4 4 12 12" />
    <path d="M12 4 4 12" />
  </ActionStroke>
);
