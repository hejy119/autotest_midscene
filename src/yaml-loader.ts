import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

/**
 * 步骤动作类型 —— 全部对应 Midscene Agent 的原生方法，写法与官方文档一致。
 *
 * 用法参考：https://midscenejs.com/（YAML 写法）
 *   - 通用指令：ai / aiAct / aiAction / instruction
 *   - 精确动作：aiTap / aiInput / aiKeyboardPress / aiScroll / aiHover /
 *               aiRightClick / aiDoubleClick / aiLongPress / aiClearInput / aiPinch
 *   - 断言查询：aiAssert / aiWaitFor / aiQuery / aiAsk / aiLocate /
 *               aiBoolean / aiNumber / aiString
 *   - 报告记录：recordToReport / logScreenshot
 *   - 脚本：javascript / runGherkinScenario
 *   - 框架辅助（官方没有）：url 跳转 / log 打日志
 */
export type StepAction =
  | 'ai'
  | 'aiAssert'
  | 'aiWaitFor'
  | 'aiTap'
  | 'aiInput'
  | 'aiKeyboardPress'
  | 'aiScroll'
  | 'aiHover'
  | 'aiRightClick'
  | 'aiDoubleClick'
  | 'aiLongPress'
  | 'aiClearInput'
  | 'aiPinch'
  | 'aiQuery'
  | 'aiAsk'
  | 'aiLocate'
  | 'aiBoolean'
  | 'aiNumber'
  | 'aiString'
  | 'recordToReport'
  | 'logScreenshot'
  | 'javascript'
  | 'runGherkinScenario'
  | 'url'
  | 'sleep'
  | 'log';

/** aiScroll 滚动类型（官方 ScrollParam.scrollType + 旧别名，见 @midscene/core yaml.d.ts） */
export type ScrollType =
  | 'singleAction'
  | 'scrollToBottom'
  | 'scrollToTop'
  | 'scrollToRight'
  | 'scrollToLeft'
  | 'once'
  | 'untilBottom'
  | 'untilTop'
  | 'untilRight'
  | 'untilLeft';

export interface Step {
  action: StepAction;
  /** 定位/指令文本 */
  prompt?: string;
  /** aiInput 要输入的值 */
  value?: string | number;
  /** aiKeyboardPress 要按的键 */
  keyName?: string;
  /** aiScroll / aiPinch 方向 */
  direction?: 'down' | 'up' | 'left' | 'right' | 'in' | 'out';
  /** aiScroll 滚动距离 */
  distance?: number;
  /** aiScroll 滚动类型：scrollToBottom / scrollToTop / once / untilBottom 等 */
  scrollType?: ScrollType;
  /** aiWaitFor 超时（毫秒） */
  timeoutMs?: number;
  /** aiAssert 自定义失败信息 */
  errorMessage?: string;
  /** recordToReport 正文 */
  content?: string;
  /** log / recordToReport 标题 */
  message?: string;
  /** javascript 脚本 */
  script?: string;
  /** 查询结果命名（aiQuery 等） */
  name?: string;
  /** aiAct 附加选项 */
  cacheable?: boolean;
  context?: string;
  /** url 跳转地址 */
  url?: string;
  /** sleep 毫秒数（官方单位） */
  ms?: number;
}

export interface TestCase {
  name: string;
  file: string;
  steps: Step[];
}

const str = (v: any): string => (v == null ? '' : String(v).trim());

/** "ai tap" → "aiTap"，用于给用户提示官方写法 */
function toCamel(k: string): string {
  return k
    .split(/[\s_-]+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/** 官方方法名 → 动作 */
const ACTION_KEY_MAP: Record<string, StepAction> = {
  ai: 'ai',
  aiAct: 'ai',
  aiAction: 'ai',
  instruction: 'ai',
  aiAssert: 'aiAssert',
  aiWaitFor: 'aiWaitFor',
  aiTap: 'aiTap',
  aiInput: 'aiInput',
  aiKeyboardPress: 'aiKeyboardPress',
  aiScroll: 'aiScroll',
  aiHover: 'aiHover',
  aiRightClick: 'aiRightClick',
  aiDoubleClick: 'aiDoubleClick',
  aiLongPress: 'aiLongPress',
  aiClearInput: 'aiClearInput',
  aiPinch: 'aiPinch',
  aiQuery: 'aiQuery',
  aiAsk: 'aiAsk',
  aiLocate: 'aiLocate',
  aiBoolean: 'aiBoolean',
  aiNumber: 'aiNumber',
  aiString: 'aiString',
  recordToReport: 'recordToReport',
  logScreenshot: 'logScreenshot',
  javascript: 'javascript',
  runGherkinScenario: 'runGherkinScenario',
  sleep: 'sleep',
  url: 'url',
  log: 'log',
};

const ALL_ACTIONS = Object.keys(ACTION_KEY_MAP);

/**
 * 扫描指定 YAML 文件（或 test_case 目录下所有 YAML），解析出全部用例。
 */
export function loadTestCases(testCaseDir: string, targetFiles: string[]): TestCase[] {
  const files = resolveYamlFiles(testCaseDir, targetFiles);
  const cases: TestCase[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = YAML.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e: any) {
      throw new Error(`解析 YAML 失败（${path.basename(file)}）：${e?.message}`);
    }
    // file 存相对 testCaseDir 的路径（含目录，如 作业/作业主页.yaml），报告按此分组
    const rel = path.relative(testCaseDir, file).split(path.sep).join('/');
    cases.push(...parseFile(rel, raw));
  }
  return cases;
}

function resolveYamlFiles(dir: string, targetFiles: string[]): string[] {
  if (targetFiles.length > 0) {
    return targetFiles
      .map((f) => path.resolve(dir, f))
      .filter((f) => fs.existsSync(f));
  }
  if (!fs.existsSync(dir)) return [];
  // 递归收集目录下所有 YAML（支持 test_case/ 下的子目录，报告按目录/文件分组）
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (f.endsWith('.yaml') || f.endsWith('.yml')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function parseFile(file: string, raw: unknown): TestCase[] {
  if (!Array.isArray(raw)) {
    // 兼容：文件直接写单个用例对象（没有最外层列表）
    if (raw && typeof raw === 'object') return [parseCase(file, raw as any, 0)];
    return [];
  }
  return raw.map((c, i) => parseCase(file, c, i));
}

function parseCase(file: string, raw: any, idx: number): TestCase {
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `用例${idx + 1}`;
  let steps: Step[] = [];
  if (Array.isArray(raw?.steps)) {
    for (const s of raw.steps) steps.push(...parseStep(s));
  } else {
    // 基础格式：ai（操作步骤，对应 Excel 操作步骤）+ aiAssert（预期结果，对应 Excel 预期结果）
    steps.push(...expandBasic('ai', raw?.ai));
    steps.push(...expandBasic('aiAssert', raw?.aiAssert));
  }
  return { name, file, steps };
}

/** 基础格式：展开字符串 / 数组为一条或多条步骤 */
function expandBasic(action: StepAction, value: any): Step[] {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .filter((v) => v != null && str(v) !== '')
    .map((v) => normalizeStep(action, v, {}));
}

/**
 * 解析一条 steps 里的步骤。
 * 一个步骤可以带多个键（比如 - aiScroll: 定位 / direction: down / distance: 300）。
 * 动作键是官方方法名（camelCase），其余键作为参数。
 */
function parseStep(s: any): Step[] {
  if (typeof s === 'string') return [{ action: 'ai', prompt: s.trim() }];
  if (!s || typeof s !== 'object') return [];
  const keys = Object.keys(s);
  if (keys.length === 0) return [];

  const actionKey = keys.find((k) => ACTION_KEY_MAP[k]);
  if (!actionKey) {
    const hint = keys[0].includes(' ')
      ? `（官方写法是 camelCase，比如「${keys[0]}」应写作「${toCamel(keys[0])}」）`
      : '';
    throw new Error(`未知动作「${keys[0]}」${hint}，支持的动作为：${ALL_ACTIONS.join('、')}`);
  }
  const action = ACTION_KEY_MAP[actionKey];
  const rest = { ...s };
  delete rest[actionKey];
  return [normalizeStep(action, s[actionKey], rest)];
}

/** 把某动作的值 + 兄弟参数整理成统一 Step */
function normalizeStep(action: StepAction, value: any, rest: any): Step {
  const promptFromValue = typeof value === 'string' ? value : str(value?.prompt ?? value?.locate ?? '');
  switch (action) {
    case 'ai':
      return { action, prompt: promptFromValue, cacheable: rest.cacheable, context: rest.context };
    case 'aiAssert':
      return { action, prompt: promptFromValue, errorMessage: str(rest.errorMessage) || undefined };
    case 'aiWaitFor': {
      const t = Number(rest.timeout ?? rest.timeoutMs);
      return {
        action,
        prompt: promptFromValue,
        timeoutMs: Number.isFinite(t) && t > 0 ? t : undefined,
      };
    }
    case 'aiInput': {
      // 官方逻辑：有 locate 时 aiInput 存的是要输入的值；否则 aiInput 存定位、value 存值
      if (rest.locate) return { action, prompt: str(rest.locate), value: value ?? rest.value };
      return { action, prompt: promptFromValue, value: rest.value ?? '' };
    }
    case 'aiKeyboardPress': {
      if (rest.locate) return { action, prompt: str(rest.locate), keyName: str(value) };
      if (rest.keyName) return { action, prompt: promptFromValue, keyName: str(rest.keyName) };
      return { action, prompt: undefined, keyName: str(value) };
    }
    case 'aiScroll': {
      const locate = rest.locate ?? value;
      const locatePrompt = typeof locate === 'string' ? locate : str(locate?.prompt ?? '');
      return {
        action,
        prompt: locatePrompt,
        direction: str(rest.direction).toLowerCase() as any || undefined,
        distance: rest.distance == null ? undefined : Number(rest.distance),
        scrollType: (str(rest.scrollType) as ScrollType) || undefined,
      };
    }
    case 'aiPinch':
      return {
        action,
        prompt: promptFromValue,
        direction: str(rest.direction).toLowerCase() === 'out' ? 'out' : 'in',
      };
    case 'aiTap':
    case 'aiHover':
    case 'aiRightClick':
    case 'aiDoubleClick':
    case 'aiLongPress':
    case 'aiClearInput':
      return { action, prompt: promptFromValue };
    case 'aiQuery':
    case 'aiAsk':
    case 'aiLocate':
    case 'aiBoolean':
    case 'aiNumber':
    case 'aiString':
      return { action, prompt: promptFromValue, name: rest.name };
    case 'recordToReport':
    case 'logScreenshot':
      return { action, message: promptFromValue || '记录', content: str(rest.content) || undefined };
    case 'javascript':
      return { action, script: promptFromValue || str(rest.script), name: rest.name };
    case 'runGherkinScenario':
      return { action, prompt: promptFromValue };
    case 'url':
      return { action, url: str(value) };
    case 'sleep':
      return { action, ms: Number(value) };
    case 'log':
      return { action, message: str(value) };
    default:
      throw new Error(`未知动作「${action}」`);
  }
}
