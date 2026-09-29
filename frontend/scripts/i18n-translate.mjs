#!/usr/bin/env node
/**
 * Tự động dịch khóa i18n (khóa = chuỗi tiếng Trung gốc) sang tiếng Việt bằng Claude Code CLI.
 *
 *   node scripts/i18n-translate.mjs            # dịch các khóa còn thiếu trong vi.json
 *   node scripts/i18n-translate.mjs --check    # chỉ liệt kê số khóa thiếu
 *   node scripts/i18n-translate.mjs --prune    # xóa khóa không còn dùng trong code
 *   node scripts/i18n-translate.mjs --from mumu-missing-translations.json
 *                                              # thêm chuỗi chưa dịch xuất từ Cài đặt (nút "Xuất chuỗi chưa dịch")
 *
 * Hai nhóm được dịch:
 *   - translation: khóa t('...') / tr('...') trong code frontend -> locales/vi.json
 *   - values: dữ liệu từ backend (locales/values.source.json, tạo bằng backend/scripts/export_i18n_values.py)
 *             và label('...') -> locales/values.vi.json, dùng cho lớp nghĩa label()
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
const LOCALES = path.join(SRC, 'i18n', 'locales');
const VI_PATH = path.join(LOCALES, 'vi.json');
const VALUES_SOURCE_PATH = path.join(LOCALES, 'values.source.json');
const VALUES_VI_PATH = path.join(LOCALES, 'values.vi.json');
// Khóa t() chỉ gặp lúc chạy (tra bằng biến), lưu lại từ --from để không bị --prune xóa
const RUNTIME_KEYS_PATH = path.join(LOCALES, 'runtime-keys.json');
// Giá trị label() chỉ gặp lúc chạy (dữ liệu dựng sẵn trong DB, mô tả Skill...), lưu từ --from
const RUNTIME_VALUES_PATH = path.join(LOCALES, 'values.runtime.json');
const MODEL = process.env.I18N_MODEL || 'sonnet';
const BATCH = Number(process.env.I18N_BATCH || 100);
const CONCURRENCY = Number(process.env.I18N_CONCURRENCY || 6);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const GLOSSARY = `大纲=Dàn ý; 章节=Chương; 角色=Nhân vật; 伏笔=Phục bút; 世界观=Thế giới quan; 组织=Tổ chức;
灵感=Cảm hứng; 职业=Nghề nghiệp; 关系=Quan hệ; 书架=Tủ sách; 项目=Dự án; 提示词=Prompt; 模板=Mẫu;
技能=Kỹ năng; 设置=Cài đặt; 生成=Tạo; 重新生成=Tạo lại; 续写=Viết tiếp; 润色=Trau chuốt; 拆书=Phân tích sách;
字数=Số chữ; 模型=Model; 插件=Plugin; 写作风格=Phong cách viết; 剧情=Cốt truyện; 卷=Quyển; 主角=Nhân vật chính`;

const SYSTEM = `You translate UI strings (labels, options, status/progress and error messages) of a Chinese AI novel-writing web app into natural, concise Vietnamese.
Rules:
- Input: a JSON object {"id": "Chinese string"}. Output: ONLY a JSON object with the same ids mapped to Vietnamese. No markdown fences, no commentary.
- Keep placeholders exactly as-is: {{name}}, {name}, %s, %d, HTML tags, markdown, emoji, URLs, code, numbers, English product names (MCP, API, JSON, AI, Token...).
- Keep leading/trailing spaces, punctuation style and line breaks. Translate Chinese punctuation to Vietnamese/Latin punctuation (，→, 。→. ：→: ！→! ？→? （）→()).
- It is UI text: buttons short, messages clear. Use consistent terminology: ${GLOSSARY}`;

// Khóa chỉ được tra qua biến (t(variable)), regex không tìm thấy.
const EXTRA_KEYS = ['让AI重新生成', '组织成员', '主职业', '副职业', '职业分类', 'Skill·长篇', 'Skill·短篇',
  'Skill·润色', 'Skill·工具', '男', '女', '其他', '第一人称', '第三人称', '全知视角'];

function unescapeJs(raw, quote) {
  if (quote === '`') return raw;
  let json = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      i += 1;
      json += next === "'" ? "'" : next === '`' ? '`' : '\\' + next;
    } else if (ch === '"') {
      json += '\\"';
    } else {
      json += ch;
    }
  }
  try {
    return JSON.parse(`"${json}"`);
  } catch {
    return raw;
  }
}

function collectKeys() {
  const keys = new Set(EXTRA_KEYS);
  const values = new Set();
  const labelRe = /(?<![\w$.])label\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
  const re = /(?<![\w$.])(?:i18n\.)?(?:t|tr)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
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
  if (fs.existsSync(VALUES_SOURCE_PATH)) {
    for (const v of JSON.parse(fs.readFileSync(VALUES_SOURCE_PATH, 'utf8'))) values.add(v);
  }
  if (fs.existsSync(RUNTIME_VALUES_PATH)) {
    for (const v of JSON.parse(fs.readFileSync(RUNTIME_VALUES_PATH, 'utf8'))) values.add(v);
  }
  if (fs.existsSync(RUNTIME_KEYS_PATH)) {
    for (const k of JSON.parse(fs.readFileSync(RUNTIME_KEYS_PATH, 'utf8'))) keys.add(k);
  }
  return { translation: [...keys], values: [...values] };
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

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8') || '{}') : {};
}

function writeSorted(file, obj) {
  const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

async function translateInto(name, file, keys, { prune, check }) {
  const table = readJson(file);
  const keySet = new Set(keys);
  const missing = keys.filter((k) => !table[k]);
  const stale = Object.keys(table).filter((k) => !keySet.has(k));
  console.log(`[${name}] keys=${keys.length} translated=${keys.length - missing.length} missing=${missing.length} stale=${stale.length}`);
  if (prune && stale.length) {
    stale.forEach((k) => delete table[k]);
    writeSorted(file, table);
    console.log(`[${name}] pruned ${stale.length} stale keys`);
  }
  if (check || !missing.length) return;

  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
  let done = 0;
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const batch = queue.shift();
        Object.assign(table, await translateBatch(batch));
        done += 1;
        writeSorted(file, table);
        console.log(`  [${name}] batch ${done}/${batches.length} done`);
      }
    }),
  );
  console.log(`[${name}] finished: missing=${keys.filter((k) => !table[k]).length}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const fromIndex = argv.indexOf('--from');
  const collected = collectKeys();
  const extra = { translation: [], values: [] };
  if (fromIndex >= 0) {
    const file = argv[fromIndex + 1];
    if (!file) throw new Error('--from cần đường dẫn file JSON');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    extra.translation = Array.isArray(data.translation) ? data.translation : [];
    extra.values = Array.isArray(data.values) ? data.values : [];
    // Lưu lại để lần chạy sau (và --prune) vẫn giữ các chuỗi này
    const appendTo = (file, items) => {
      if (!items.length) return;
      const set = new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
      items.forEach((v) => set.add(v));
      fs.writeFileSync(file, JSON.stringify([...set].sort(), null, 2) + '\n', 'utf8');
    };
    appendTo(RUNTIME_VALUES_PATH, extra.values);
    appendTo(RUNTIME_KEYS_PATH, extra.translation);
  }
  const uniq = (a) => [...new Set(a)];
  const prune = argv.includes('--prune');
  const all = fromIndex >= 0 ? collectKeys() : collected;
  await translateInto('translation', VI_PATH, uniq(all.translation), { prune, check });
  await translateInto('values', VALUES_VI_PATH, uniq(all.values), { prune, check });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
