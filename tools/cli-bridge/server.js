#!/usr/bin/env node
/*
 * MuMu CLI Bridge
 *
 * Exposes an OpenAI-compatible API (/v1/models, /v1/chat/completions) and
 * serves each request by running the locally installed, already logged-in
 * Claude Code CLI (`claude`) or OpenAI Codex CLI (`codex`).
 *
 * No npm dependencies: only Node.js built-ins (Node 18+).
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const IS_WINDOWS = process.platform === 'win32';
const CONFIG_PATH = process.env.BRIDGE_CONFIG || path.join(__dirname, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'config.example.json');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 8787,
  apiKey: '',
  requestTimeoutSeconds: 900,
  keepaliveSeconds: 15,
  maxBodyMB: 20,
  // Replaces the CLIs' built-in coding-agent persona.
  baseSystemPrompt:
    'You are a text generation backend for a novel-writing application. ' +
    'Follow the instructions exactly and reply with only the requested content in the requested format ' +
    '(for example, when JSON is requested, output only the JSON). ' +
    'Do not add greetings, explanations or questions unless asked. ' +
    'You have no tools, files or shell; never mention them.',
  claude: {
    enabled: true,
    command: 'claude',
    maxConcurrent: 2,
    models: {
      'claude-sonnet': 'sonnet',
      'claude-opus': 'opus',
      'claude-haiku': 'haiku',
    },
    extraArgs: [],
  },
  codex: {
    enabled: true,
    command: 'codex',
    maxConcurrent: 2,
    models: {
      codex: '',
    },
    reasoningEffort: '',
    extraArgs: [],
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key.startsWith('_')) continue;
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object'
        ? deepMerge(base[key], value)
        : value;
  }
  return out;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    let initial = {};
    try {
      initial = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
    } catch {
      initial = {};
    }
    initial.apiKey = 'mumu-' + crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2) + '\n', 'utf8');
    console.log(`[bridge] Created ${CONFIG_PATH} with a new random apiKey.`);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const cfg = deepMerge(DEFAULT_CONFIG, raw);
  if (process.env.BRIDGE_HOST) cfg.host = process.env.BRIDGE_HOST;
  if (process.env.BRIDGE_PORT) cfg.port = Number(process.env.BRIDGE_PORT);
  if (process.env.BRIDGE_API_KEY) cfg.apiKey = process.env.BRIDGE_API_KEY;
  if (!cfg.apiKey) throw new Error('apiKey is empty in config.json; set a long random value.');
  return cfg;
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

class Semaphore {
  constructor(max) {
    this.max = Math.max(1, Number(max) || 1);
    this.active = 0;
    this.queue = [];
  }
  acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active -= 1;
  }
}

const semaphores = {
  claude: new Semaphore(config.claude.maxConcurrent),
  codex: new Semaphore(config.codex.maxConcurrent),
};

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendError(res, status, message, type = 'bridge_error') {
  sendJson(res, status, { error: { message, type, code: status } });
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

// Only simple tokens may reach the command line (model names, effort levels).
const SAFE_ARG = /^[A-Za-z0-9._:\-\[\]\/=@]+$/;

function assertSafeArg(value, what) {
  if (!SAFE_ARG.test(value)) throw Object.assign(new Error(`Invalid ${what}: ${value}`), { status: 400 });
  return value;
}

// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------

function listModels() {
  const ids = [];
  if (config.claude.enabled) ids.push(...Object.keys(config.claude.models));
  if (config.codex.enabled) ids.push(...Object.keys(config.codex.models));
  return ids;
}

/** Resolve an OpenAI `model` id into { backend, cliModel }. */
function resolveModel(model) {
  const id = String(model || '').trim();
  if (!id) throw Object.assign(new Error('model is required'), { status: 400 });
  const lower = id.toLowerCase();

  if (config.claude.enabled && Object.prototype.hasOwnProperty.call(config.claude.models, id)) {
    return { backend: 'claude', cliModel: config.claude.models[id] };
  }
  if (config.codex.enabled && Object.prototype.hasOwnProperty.call(config.codex.models, id)) {
    return { backend: 'codex', cliModel: config.codex.models[id] };
  }
  // Pass-through: "claude-..." full model ids go to Claude, "codex:<model>" / gpt-* / o* go to Codex.
  if (config.claude.enabled && lower.startsWith('claude')) {
    return { backend: 'claude', cliModel: id };
  }
  if (config.codex.enabled) {
    if (lower.startsWith('codex:')) return { backend: 'codex', cliModel: id.slice(6) };
    if (/^(gpt-|o\d)/.test(lower)) return { backend: 'codex', cliModel: id };
  }
  throw Object.assign(new Error(`Unknown model "${id}". Available: ${listModels().join(', ')}`), {
    status: 404,
  });
}

// ---------------------------------------------------------------------------
// Prompt building (OpenAI messages -> single CLI prompt)
// ---------------------------------------------------------------------------

function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && (part.type === 'text' || part.type === 'input_text')) return part.text || '';
        return '';
      })
      .join('');
  }
  return String(content);
}

function toolsInstruction(tools) {
  const specs = tools
    .filter((t) => t && t.type === 'function' && t.function && t.function.name)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      parameters: t.function.parameters || { type: 'object', properties: {} },
    }));
  if (!specs.length) return '';
  return [
    '# Available tools',
    'You can call the tools below. To call one or more tools, reply with ONLY tool call blocks, nothing else:',
    '<tool_call>{"name": "<tool name>", "arguments": { ... }}</tool_call>',
    'Each block must contain valid JSON. After the tool results arrive you will be asked again.',
    'If you do not need a tool, answer normally and do not write any <tool_call> block.',
    'Never use any other built-in tools, files or shell commands.',
    '',
    JSON.stringify(specs, null, 2),
  ].join('\n');
}

/**
 * Returns { system, prompt }.
 * A single user message is passed through verbatim; longer conversations are
 * rendered as a labelled transcript.
 */
function buildPrompt(messages, tools, toolChoice) {
  const systemParts = [];
  const turns = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;
    const text = contentToText(msg.content);
    if (role === 'system' || role === 'developer') {
      if (text) systemParts.push(text);
    } else if (role === 'assistant') {
      let out = text;
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const calls = msg.tool_calls
          .map((tc) => {
            let args = tc.function?.arguments ?? '{}';
            if (typeof args !== 'string') args = JSON.stringify(args);
            return `<tool_call>{"name": ${JSON.stringify(tc.function?.name || '')}, "arguments": ${args}}</tool_call>`;
          })
          .join('\n');
        out = out ? `${out}\n${calls}` : calls;
      }
      turns.push({ role: 'assistant', text: out });
    } else if (role === 'tool' || role === 'function') {
      const name = msg.name || msg.tool_call_id || 'tool';
      turns.push({ role: 'tool', text: `[Tool result: ${name}]\n${text}` });
    } else {
      turns.push({ role: 'user', text });
    }
  }

  if (config.baseSystemPrompt) systemParts.unshift(config.baseSystemPrompt);
  const useTools = Array.isArray(tools) && tools.length && toolChoice !== 'none';
  if (useTools) {
    const instr = toolsInstruction(tools);
    if (instr) systemParts.push(instr);
  }

  let prompt;
  if (turns.length === 1 && turns[0].role === 'user') {
    prompt = turns[0].text;
  } else {
    const labels = { user: 'USER', assistant: 'ASSISTANT', tool: 'TOOL' };
    prompt =
      'The following is a conversation transcript. Write the next ASSISTANT reply only.\n\n' +
      turns.map((t) => `### ${labels[t.role]}\n${t.text}`).join('\n\n') +
      '\n\n### ASSISTANT\n';
  }
  return { system: systemParts.join('\n\n'), prompt, useTools: Boolean(useTools) };
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

function extractToolCalls(text) {
  const calls = [];
  let match;
  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      if (!obj || typeof obj.name !== 'string') continue;
      calls.push({
        id: newId('call'),
        type: 'function',
        function: {
          name: obj.name,
          arguments: JSON.stringify(obj.arguments ?? {}),
        },
      });
    } catch {
      // ignore malformed block
    }
  }
  const rest = text.replace(TOOL_CALL_RE, '').trim();
  return { calls, rest };
}

// ---------------------------------------------------------------------------
// Running the CLIs
// ---------------------------------------------------------------------------

function quoteForCmd(arg) {
  // Arguments are either validated SAFE_ARG tokens, fixed flags, or paths we
  // created ourselves; user text never reaches the command line.
  if (arg === '') return '""';
  if (/[\s"&|<>^%!]/.test(arg)) return `"${arg.replace(/"/g, '""')}"`;
  return arg;
}

function spawnCli(command, args, cwd) {
  const needsShell = IS_WINDOWS && !/\.exe$/i.test(command);
  if (needsShell) {
    // npm installs claude.cmd / codex.cmd on Windows, which Node can only start via cmd.exe.
    const line = [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ');
    return spawn(line, { cwd, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

function makeWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mumu-cli-bridge-'));
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/**
 * Runs one CLI job.
 * handlers: { onDelta(text), onDone({ text, usage }), onError(err) }
 * Returns { cancel() }.
 */
function runJob(backend, cliModel, system, prompt, handlers) {
  const workDir = makeWorkDir();
  let args;
  let stdinText = prompt;

  if (backend === 'claude') {
    args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
    ];
    if (cliModel) args.push('--model', assertSafeArg(cliModel, 'model'));
    if (system) {
      const sysFile = path.join(workDir, 'system-prompt.txt');
      fs.writeFileSync(sysFile, system, 'utf8');
      args.push('--system-prompt-file', sysFile);
    }
    args.push(...(config.claude.extraArgs || []));
  } else {
    args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', workDir];
    if (cliModel) args.push('-m', assertSafeArg(cliModel, 'model'));
    if (config.codex.reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${assertSafeArg(config.codex.reasoningEffort, 'reasoningEffort')}`);
    }
    args.push(...(config.codex.extraArgs || []));
    args.push('-');
    stdinText =
      (system ? `<system_instructions>\n${system}\n</system_instructions>\n\n` : '') +
      'Answer the request below directly. Do not run commands or edit files.\n\n' +
      prompt;
  }

  const command = backend === 'claude' ? config.claude.command : config.codex.command;
  let child;
  try {
    child = spawnCli(command, args, workDir);
  } catch (err) {
    removeDir(workDir);
    setImmediate(() => handlers.onError(err));
    return { cancel() {} };
  }

  let finished = false;
  let fullText = '';
  let resultText = null;
  let usage = null;
  let errorMessage = null;
  let stderr = '';
  let buffer = '';

  const finish = (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    removeDir(workDir);
    if (err) handlers.onError(err);
    else handlers.onDone({ text: resultText ?? fullText, usage });
  };

  const timer = setTimeout(() => {
    killChild();
    finish(new Error(`CLI timed out after ${config.requestTimeoutSeconds}s`));
  }, config.requestTimeoutSeconds * 1000);

  function killChild() {
    if (!child || child.exitCode !== null) return;
    if (IS_WINDOWS && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }

  const emitDelta = (text) => {
    if (!text) return;
    fullText += text;
    handlers.onDelta(text);
  };

  const handleClaudeEvent = (ev) => {
    if (ev.type === 'stream_event' && ev.event) {
      const e = ev.event;
      if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') emitDelta(e.delta.text);
    } else if (ev.type === 'result') {
      if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
        errorMessage = (typeof ev.result === 'string' && ev.result) || ev.subtype || 'Claude CLI error';
      } else if (typeof ev.result === 'string') {
        resultText = ev.result;
        // If partial messages were not streamed (older CLI), emit the rest now.
        if (!fullText && resultText) emitDelta(resultText);
      }
      const u = ev.usage || {};
      const input =
        (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      usage = { prompt_tokens: input, completion_tokens: u.output_tokens || 0 };
    }
  };

  const handleCodexEvent = (ev) => {
    const item = ev.item || ev.msg;
    if (ev.type === 'item.completed' && item) {
      const kind = item.type || item.item_type;
      if (kind === 'agent_message' || kind === 'assistant_message') {
        const text = item.text || contentToText(item.content);
        if (text) emitDelta(fullText ? `\n\n${text}` : text);
      }
    } else if (ev.type === 'turn.completed' && ev.usage) {
      usage = {
        prompt_tokens: (ev.usage.input_tokens || 0),
        completion_tokens: ev.usage.output_tokens || 0,
      };
    } else if (ev.type === 'turn.failed') {
      errorMessage = ev.error?.message || 'Codex turn failed';
    } else if (ev.type === 'error') {
      errorMessage = ev.message || ev.error?.message || 'Codex error';
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('{')) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (backend === 'claude') handleClaudeEvent(ev);
      else handleCodexEvent(ev);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 20000) stderr += chunk;
  });
  child.on('error', (err) => finish(new Error(`Cannot start "${command}": ${err.message}`)));
  child.on('close', (code) => {
    if (errorMessage) return finish(new Error(errorMessage));
    if (code !== 0 && !(resultText ?? fullText)) {
      const detail = stderr.trim().split('\n').slice(-5).join('\n');
      return finish(new Error(`${command} exited with code ${code}${detail ? `: ${detail}` : ''}`));
    }
    finish(null);
  });

  child.stdin.on('error', () => {});
  child.stdin.end(stdinText, 'utf8');

  return {
    cancel() {
      if (finished) return;
      killChild();
      finish(new Error('cancelled'));
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

async function handleChatCompletions(req, res) {
  let body;
  try {
    const raw = await readBody(req, config.maxBodyMB * 1024 * 1024);
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return sendError(res, err.status || 400, err.status ? err.message : 'Invalid JSON body');
  }

  let route;
  try {
    route = resolveModel(body.model);
  } catch (err) {
    return sendError(res, err.status || 400, err.message);
  }

  const { system, prompt, useTools } = buildPrompt(body.messages, body.tools, body.tool_choice);
  if (!prompt.trim()) return sendError(res, 400, 'messages must contain text');

  const stream = Boolean(body.stream);
  const id = newId('chatcmpl');
  const created = Math.floor(Date.now() / 1000);
  const model = String(body.model);
  const includeUsage = !stream || body.stream_options?.include_usage !== false;

  const semaphore = semaphores[route.backend];
  let clientGone = false;
  let job = null;
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true;
      if (job) job.cancel();
    }
  });

  await semaphore.acquire();
  if (clientGone) {
    semaphore.release();
    return;
  }

  const startedAt = Date.now();
  log(`[${route.backend}] start model=${model}${route.cliModel ? ` (${route.cliModel})` : ''} stream=${stream} tools=${useTools} prompt_chars=${prompt.length}`);

  // Headers are delayed briefly so that fast failures (not logged in, bad model)
  // can still be returned as a proper HTTP error instead of a broken 200.
  let headersSent = false;
  let keepalive = null;
  let pending = '';
  const graceTimer = setTimeout(() => openResponse(), 5000);

  function openResponse() {
    if (headersSent || clientGone) return;
    headersSent = true;
    clearTimeout(graceTimer);
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      keepalive = setInterval(() => res.write(': keepalive\n\n'), config.keepaliveSeconds * 1000);
      writeChunk({ role: 'assistant', content: '' });
      if (pending) {
        writeChunk({ content: pending });
        pending = '';
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      // JSON parsers ignore leading whitespace; this keeps the HTTP read timeout alive.
      keepalive = setInterval(() => res.write(' '), config.keepaliveSeconds * 1000);
    }
  }

  function writeChunk(delta, finishReason = null, extra = {}) {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...extra,
      })}\n\n`,
    );
  }

  const cleanup = () => {
    clearTimeout(graceTimer);
    if (keepalive) clearInterval(keepalive);
    semaphore.release();
  };

  job = runJob(route.backend, route.cliModel, system, prompt, {
    onDelta(text) {
      // With emulated tools we must see the whole answer before deciding.
      if (!stream || useTools) return;
      if (!headersSent) openResponse();
      if (headersSent) writeChunk({ content: text });
      else pending += text;
    },
    onDone({ text, usage }) {
      cleanup();
      if (clientGone) return;
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      log(`[${route.backend}] done in ${seconds}s chars=${text.length}`);
      const usageObj = usage
        ? { ...usage, total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) }
        : undefined;

      let content = text;
      let toolCalls = [];
      if (useTools) {
        const extracted = extractToolCalls(text);
        toolCalls = extracted.calls;
        if (toolCalls.length) content = extracted.rest;
      }
      const finishReason = toolCalls.length ? 'tool_calls' : 'stop';

      if (!headersSent) openResponse();
      if (stream) {
        if (useTools) {
          if (content) writeChunk({ content });
          if (toolCalls.length) {
            writeChunk({ tool_calls: toolCalls.map((tc, index) => ({ index, ...tc })) });
          }
        }
        writeChunk({}, finishReason, includeUsage && usageObj ? { usage: usageObj } : {});
        res.end('data: [DONE]\n\n');
      } else {
        const message = { role: 'assistant', content: content || (toolCalls.length ? null : '') };
        if (toolCalls.length) message.tool_calls = toolCalls;
        res.end(
          JSON.stringify({
            id,
            object: 'chat.completion',
            created,
            model,
            choices: [{ index: 0, message, finish_reason: finishReason }],
            ...(usageObj ? { usage: usageObj } : {}),
          }),
        );
      }
    },
    onError(err) {
      cleanup();
      if (clientGone) return;
      log(`[${route.backend}] error: ${err.message}`);
      if (!headersSent) {
        headersSent = true;
        return sendError(res, err.status || 502, err.message);
      }
      const payload = { error: { message: err.message, type: 'bridge_error', code: 502 } };
      if (stream) {
        res.end(`data: ${JSON.stringify(payload)}\n\n`);
      } else {
        res.end(JSON.stringify(payload));
      }
    },
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (pathname === '/health' || pathname === '/')) {
      return sendJson(res, 200, { status: 'ok', models: listModels() });
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : req.headers['x-api-key'] || '';
    if (!timingSafeEqualStr(token, config.apiKey)) {
      return sendError(res, 401, 'Invalid API key for MuMu CLI bridge', 'authentication_error');
    }

    if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      return sendJson(res, 200, {
        object: 'list',
        data: listModels().map((idStr) => ({ id: idStr, object: 'model', created: 0, owned_by: 'cli-bridge' })),
      });
    }
    if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
      return await handleChatCompletions(req, res);
    }
    return sendError(res, 404, `Not found: ${req.method} ${pathname}`);
  } catch (err) {
    log('unhandled error', err);
    if (!res.headersSent) sendError(res, 500, err.message || 'Internal error');
    else res.end();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60000;

server.listen(config.port, config.host, () => {
  log(`MuMu CLI bridge listening on http://${config.host}:${config.port}/v1`);
  log(`Models: ${listModels().join(', ')}`);
  log(`API key is in ${CONFIG_PATH}`);
});
