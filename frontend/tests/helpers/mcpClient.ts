type JsonRpcPayload = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id?: number;
  result?: any;
  error?: {
    code?: number;
    message?: string;
    data?: any;
  };
};

const parseMcpPayload = (rawText: string): JsonRpcResponse => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('MCP respondió vacío');
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    throw new Error(`No se pudo parsear respuesta MCP: ${trimmed}`);
  }

  return JSON.parse(dataLines.join('\n'));
};

export class McpHttpClient {
  private readonly baseUrl: string;

  private requestId = 0;

  private sessionId: string | null = null;

  private protocolVersion = '2025-11-25';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private nextId() {
    this.requestId += 1;
    return this.requestId;
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': this.protocolVersion,
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    return headers;
  }

  private async send(payload: JsonRpcPayload, expectResponse = true) {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} calling MCP ${payload.method}`);
    }

    const sessionHeader = response.headers.get('Mcp-Session-Id');
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }

    if (!expectResponse) {
      return null;
    }

    const message = parseMcpPayload(await response.text());
    if (message.error) {
      throw new Error(`MCP ${payload.method} failed: ${message.error.message || 'unknown error'}`);
    }
    return message;
  }

  async initialize() {
    const response = await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'playwright-e2e',
          version: '1.0.0',
        },
      },
    });

    const negotiatedVersion = response?.result?.protocolVersion;
    if (typeof negotiatedVersion === 'string' && negotiatedVersion.trim()) {
      this.protocolVersion = negotiatedVersion;
    }

    await this.send(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      },
      false,
    );

    return response?.result;
  }

  async listTools() {
    return (await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/list',
      params: {},
    }))?.result;
  }

  async listResources() {
    return (await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'resources/list',
      params: {},
    }))?.result;
  }

  async readResource(uri: string) {
    return (await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'resources/read',
      params: { uri },
    }))?.result;
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    return (await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }))?.result;
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}) {
    return (await this.send({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'prompts/get',
      params: {
        name,
        arguments: args,
      },
    }))?.result;
  }
}
