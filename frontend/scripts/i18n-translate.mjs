#!/usr/bin/env node
/**
 * Tự động dịch khóa i18n (khóa = chuỗi tiếng Trung gốc) sang tiếng Việt bằng Claude Code CLI.
 *
 *   node scripts/i18n-translate.mjs            # dịch các khóa còn thiếu trong vi.json
 *   node scripts/i18n-translate.mjs --check    # chỉ liệt kê số khóa thiếu
 *
 * Tùy chọn qua biến môi trường: I18N_MODEL (mặc định sonnet), I18N_BATCH (100), I18N_CONCURRENCY (6),
 * CLAUDE_BIN (mặc định claude). Yêu cầu `claude` đã đăng nhập.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const VI_PATH = path.join(SRC, 'i18n', 'locales', 'vi.json');
const MODEL = process.env.I18N_MODEL || 'sonnet';
const BATCH = Number(process.env.I18N_BATCH || 100);
const CONCURRENCY = Number(process.env.I18N_CONCURRENCY || 6);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const GLOSSARY = `大纲=Dàn ý; 章节=Chương; 角色=Nhân vật; 伏笔=Phục bút; 世界观=Thế giới quan; 组织=Tổ chức;
灵感=Cảm hứng; 职业=Nghề nghiệp; 关系=Quan hệ; 书架=Tủ sách; 项目=Dự án; 提示词=Prompt; 模板=Mẫu;
技能=Kỹ năng; 设置=Cài đặt; 生成=Tạo; 重新生成=Tạo lại; 续写=Viết tiếp; 润色=Trau chuốt; 拆书=Phân tích sách;
字数=Số chữ; 模型=Model; 插件=Plugin; 写作风格=Phong cách viết; 剧情=Cốt truyện; 卷=Quyển; 主角=Nhân vật chính`;

const SYSTEM = `You translate UI strings of a Chinese AI novel-writing web app into natural, concise Vietnamese.
Rules:
- Input: a JSON object {"id": "Chinese string"}. Output: ONLY a JSON object with the same ids mapped to Vietnamese. No markdown fences, no commentary.
- Keep placeholders exactly as-is: {{name}}, {name}, %s, %d, HTML tags, markdown, emoji, URLs, code, numbers, English product names (MCP, API, JSON, AI, Token...).
- Keep leading/trailing spaces, punctuation style and line breaks. Translate Chinese punctuation to Vietnamese/Latin punctuation (，→, 。→. ：→: ！→! ？→? （）→()).
- It is UI text: buttons short, messages clear. Use consistent terminology: ${GLOSSARY}`;

function unescapeJs(raw, quote) {
  if (quote === '`') return raw;
  try {
    return JSON.parse('"' + raw.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"') + '"');
  } catch {
    return raw;
  }
}

function collectKeys() {
  const keys = new Set();
  const re = /(?<![\w$.])(?:i18n\.)?t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(ent.name)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(re)) {
          if (m[1] === '`' && m[2].includes('${')) continue;
          const key = unescapeJs(m[2], m[1]);
          if (/[一-鿿]/.test(key)) keys.add(key);
        }
      }
    }
  };
  walk(SRC);
  return [...keys];
}

function placeholders(s) {
  return (s.match(/\{\{[^}]+\}\}/g) || []).sort().join('|');
}

function runClaude(input) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
    const sysFile = path.join(dir, 'system.txt');
    fs.writeFileSync(sysFile, SYSTEM, 'utf8');
    const args = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config',
      '--no-session-persistence', '--model', MODEL, '--system-prompt-file', sysFile];
    const win = process.platform === 'win32';
    const child = win
      ? spawn([CLAUDE_BIN, ...args.map((a) => (a === '' ? '""' : `"${a}"`))].join(' '), { shell: true, cwd: dir })
      : spawn(CLAUDE_BIN, args, { cwd: dir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      fs.rmSync(dir, { recursive: true, force: true });
      try {
        const res = JSON.parse(out);
        if (res.is_error) return reject(new Error(res.result || 'claude error'));
        const text = String(res.result || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
        resolve(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
      } catch (e) {
        reject(new Error(`exit ${code}: ${e.message} ${err.slice(-300)}`));
      }
    });
    child.stdin.end(JSON.stringify(input), 'utf8');
  });
}

async function translateBatch(batch, attempt = 1) {
  const input = Object.fromEntries(batch.map((k, i) => [String(i), k]));
  try {
    const out = await runClaude(input);
    const result = {};
    const bad = [];
    batch.forEach((k, i) => {
      const v = out[String(i)];
      if (typeof v === 'string' && v.trim() && placeholders(v) === placeholders(k)) result[k] = v;
      else bad.push(k);
    });
    if (bad.length && attempt < 3) Object.assign(result, await translateBatch(bad, attempt + 1));
    return result;
  } catch (e) {
    if (attempt < 3) return translateBatch(batch, attempt + 1);
    console.error(`  batch failed: ${e.message}`);
    return {};
  }
}

async function main() {
  const vi = fs.existsSync(VI_PATH) ? JSON.parse(fs.readFileSync(VI_PATH, 'utf8') || '{}') : {};
  const keys = collectKeys();
  const missing = keys.filter((k) => !vi[k]);
  console.log(`keys=${keys.length} translated=${keys.length - missing.length} missing=${missing.length}`);
  if (process.argv.includes('--check') || !missing.length) return;

  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
  let done = 0;
  const save = () => {
    const sorted = Object.fromEntries(Object.keys(vi).sort().map((k) => [k, vi[k]]));
    fs.writeFileSync(VI_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  };
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const batch = queue.shift();
        Object.assign(vi, await translateBatch(batch));
        done += 1;
        save();
        console.log(`  batch ${done}/${batches.length} done`);
      }
    }),
  );
  const still = keys.filter((k) => !vi[k]).length;
  console.log(`finished: missing=${still}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
