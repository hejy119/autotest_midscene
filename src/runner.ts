import { Page } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { TestCase, Step } from './yaml-loader';
import { Logger } from './logger';

export interface StepResult {
  index: number;
  action: string;
  prompt?: string;
  status: 'pass' | 'fail';
  error?: string;
  durationMs: number;
  screenshot?: string; // base64 PNG，失败时捕获
}

export interface CaseResult {
  name: string;
  file: string;
  status: 'pass' | 'fail';
  error?: string;
  durationMs: number;
  steps: StepResult[];
  /** 实际执行次数（含自动重试），默认 1 */
  attempts: number;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
}

/**
 * 按顺序执行所有用例。每步实时输出日志。
 * - 每条用例失败后自动重试（RETRY_TIMES 次），全部失败才判定该用例不通过；
 * - continueOnFailure=false：存在失败用例时，判定后立即中止整个运行；
 * - continueOnFailure=true：跳过失败用例，继续下一条。
 */
export async function runSuite(
  page: Page,
  agent: PlaywrightAgent,
  cases: TestCase[],
  logger: Logger,
  continueOnFailure: boolean,
  retryTimes: number,
): Promise<{ results: CaseResult[]; summary: RunSummary }> {
  const results: CaseResult[] = [];

  for (const tc of cases) {
    const caseResult = await runOneCaseWithRetry(page, agent, tc, logger, retryTimes);
    results.push(caseResult);

    // 失败策略在「单条用例最终判定（含重试）」之后执行
    if (caseResult.status === 'fail' && !continueOnFailure) {
      logger.warn('CONTINUE_ON_FAILURE=false：终止整个运行');
      return { results, summary: summarize(results) };
    }
  }

  return { results, summary: summarize(results) };
}

/**
 * 执行单条用例，失败时自动重试（最多 retryTimes 次）。
 * 每次重试都重新执行整条用例（AI 操作偶发失败，整体重跑最有效）。
 */
async function runOneCaseWithRetry(
  page: Page,
  agent: PlaywrightAgent,
  tc: TestCase,
  logger: Logger,
  retryTimes: number,
): Promise<CaseResult> {
  let lastResult: CaseResult | undefined;
  for (let attempt = 1; attempt <= retryTimes + 1; attempt++) {
    if (attempt > 1) {
      logger.warn(
        `用例「${tc.name}」第 ${attempt - 1} 次失败，自动重试（第 ${attempt} 次 / 共 ${retryTimes + 1} 次）...`,
      );
    }
    const result = await runOneCase(page, agent, tc, logger);
    result.attempts = attempt;
    if (result.status === 'pass') return result;
    lastResult = result;
  }
  return lastResult!;
}

/** 执行单条用例的所有步骤；任一步骤失败则停止该用例剩余步骤（不再浪费 token），并标记失败 */
async function runOneCase(
  page: Page,
  agent: PlaywrightAgent,
  tc: TestCase,
  logger: Logger,
): Promise<CaseResult> {
  const caseResult: CaseResult = {
    name: tc.name,
    file: tc.file,
    status: 'pass',
    durationMs: 0,
    steps: [],
    attempts: 1,
  };
  const ct0 = Date.now();
  logger.info(`===== 用例：${tc.name}（${tc.file}）=====`);

  for (let i = 0; i < tc.steps.length; i++) {
    const stepResult = await runStep(page, agent, tc.steps[i], i, logger);
    caseResult.steps.push(stepResult);

    if (stepResult.status === 'fail') {
      caseResult.status = 'fail';
      caseResult.error = stepResult.error;
      logger.fail(`第 ${i + 1} 步失败：${stepResult.error}`);
      logger.warn('跳过本用例剩余步骤');
      break;
    }
  }

  caseResult.durationMs = Date.now() - ct0;
  if (caseResult.status === 'pass') {
    logger.pass(`用例「${tc.name}」通过，耗时 ${caseResult.durationMs}ms`);
  } else {
    logger.fail(`用例「${tc.name}」失败，耗时 ${caseResult.durationMs}ms`);
  }
  return caseResult;
}

function summarize(results: CaseResult[]): RunSummary {
  const passed = results.filter((r) => r.status === 'pass').length;
  return { total: results.length, passed, failed: results.length - passed };
}

async function runStep(
  page: Page,
  agent: PlaywrightAgent,
  step: Step,
  index: number,
  logger: Logger,
): Promise<StepResult> {
  const t0 = Date.now();
  logger.step(`第 ${index + 1} 步 [${step.action}] ${describeStep(step)}`);

  try {
    switch (step.action) {
      // —— 通用指令 ——
      case 'ai':
        await agent.aiAct(step.prompt!, {
          cacheable: step.cacheable,
          context: step.context,
        } as any);
        break;
      // —— 精确动作 ——
      case 'aiTap':
        await agent.aiTap(step.prompt!);
        break;
      case 'aiHover':
        await agent.aiHover(step.prompt!);
        break;
      case 'aiRightClick':
        await agent.aiRightClick(step.prompt!);
        break;
      case 'aiDoubleClick':
        await agent.aiDoubleClick(step.prompt!);
        break;
      case 'aiLongPress':
        await agent.aiLongPress(step.prompt!);
        break;
      case 'aiClearInput':
        await agent.aiClearInput(step.prompt!);
        break;
      case 'aiInput':
        await agent.aiInput(step.prompt!, { value: step.value ?? '' });
        break;
      case 'aiKeyboardPress':
        await agent.aiKeyboardPress(step.prompt || '', { keyName: step.keyName! });
        break;
      case 'aiPinch':
        await agent.aiPinch(step.prompt!, { direction: (step.direction as 'in' | 'out') ?? 'in' });
        break;
      case 'aiScroll':
        await agent.aiScroll(step.prompt, {
          direction: step.direction as 'down' | 'up' | 'left' | 'right' | undefined,
          distance: step.distance,
          // 官方 scrollType：scrollToBottom / scrollToTop / once / untilBottom ...（空则不传，Midscene 默认 singleAction）
          ...(step.scrollType ? { scrollType: step.scrollType } : {}),
        });
        break;
      // —— 断言 / 查询 ——
      case 'aiAssert':
        await agent.aiAssert(step.prompt!, step.errorMessage);
        break;
      case 'aiWaitFor':
        await agent.aiWaitFor(step.prompt!, { timeoutMs: step.timeoutMs } as any);
        break;
      case 'aiQuery': {
        const r = await agent.aiQuery(step.prompt!);
        logger.log(`[aiQuery 结果] ${JSON.stringify(r)}`);
        break;
      }
      case 'aiAsk': {
        const r = await agent.aiAsk(step.prompt!);
        logger.log(`[aiAsk 结果] ${r}`);
        break;
      }
      case 'aiLocate': {
        const r = await agent.aiLocate(step.prompt!);
        logger.log(`[aiLocate 结果] ${JSON.stringify(r)}`);
        break;
      }
      case 'aiBoolean': {
        const r = await agent.aiBoolean(step.prompt!);
        logger.log(`[aiBoolean 结果] ${r}`);
        break;
      }
      case 'aiNumber': {
        const r = await agent.aiNumber(step.prompt!);
        logger.log(`[aiNumber 结果] ${r}`);
        break;
      }
      case 'aiString': {
        const r = await agent.aiString(step.prompt!);
        logger.log(`[aiString 结果] ${r}`);
        break;
      }
      // —— 报告记录 ——
      case 'recordToReport':
      case 'logScreenshot':
        await agent.recordToReport(step.message, { content: step.content });
        break;
      // —— 脚本 ——
      case 'javascript': {
        const r = await agent.evaluateJavaScript(step.script!);
        logger.log(`[javascript 结果] ${JSON.stringify(r)}`);
        break;
      }
      case 'runGherkinScenario':
        await agent.runGherkinScenario(step.prompt!, { cacheable: false } as any);
        break;
      // —— 框架辅助 ——
      case 'url':
        await page.goto(step.url!, { waitUntil: 'domcontentloaded' });
        break;
      case 'sleep':
        await page.waitForTimeout(step.ms || 0);
        break;
      case 'log':
        logger.log(`[自定义] ${step.message}`);
        break;
      default:
        throw new Error(`未知动作类型：${(step as Step).action}`);
    }
    logger.pass(`第 ${index + 1} 步通过`);
    return { index, action: step.action, prompt: describeStep(step), status: 'pass', durationMs: Date.now() - t0 };
  } catch (e: any) {
    let screenshot: string | undefined;
    try {
      screenshot = (await page.screenshot()).toString('base64');
    } catch {
      // 截图失败不影响主流程
    }
    return {
      index,
      action: step.action,
      prompt: describeStep(step),
      status: 'fail',
      error: e?.message || String(e),
      durationMs: Date.now() - t0,
      screenshot,
    };
  }
}

/** 生成给用户看的一行描述 */
export function describeStep(step: Step): string {
  switch (step.action) {
    case 'aiInput':
      return `${step.prompt} → 输入「${step.value}」`;
    case 'aiKeyboardPress':
      return `${step.prompt || ''} → 按键 ${step.keyName}`.trim();
    case 'aiScroll':
      return `${step.prompt ?? ''} → 滚动 ${step.scrollType ? `[${step.scrollType}] ` : ''}${step.direction ?? 'down'}${step.distance ? ` ${step.distance}px` : ''}`.trim();
    case 'aiPinch':
      return `${step.prompt ?? ''} → 捏合 ${step.direction ?? 'in'}`.trim();
    case 'aiWaitFor':
      return `${step.prompt}${step.timeoutMs ? `（超时 ${(step.timeoutMs / 1000).toFixed(0)} 秒）` : ''}`;
    case 'javascript':
      return step.script ?? '';
    case 'recordToReport':
    case 'logScreenshot':
      return step.message ?? '';
    case 'url':
      return step.url ?? '';
    case 'sleep':
      return `${(step.ms || 0) / 1000} 秒`;
    case 'log':
      return step.message ?? '';
    case 'aiQuery':
    case 'aiAsk':
    case 'aiLocate':
    case 'aiBoolean':
    case 'aiNumber':
    case 'aiString':
    case 'aiAssert':
    case 'aiTap':
    case 'aiHover':
    case 'aiRightClick':
    case 'aiDoubleClick':
    case 'aiLongPress':
    case 'aiClearInput':
    case 'runGherkinScenario':
    case 'ai':
      return step.prompt ?? '';
    default:
      return step.prompt ?? '';
  }
}
