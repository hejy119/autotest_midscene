import { Page } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { Logger } from './logger';
import { AppConfig } from './config';

/**
 * 框架内置统一登录逻辑。
 * 登录 URL / 账号 / 密码 / AI 登录指令 / 成功断言全部来自 .env，
 * 测试用例里永远不需要写登录步骤。
 *
 * 登录方式两种，确定性优先、AI 兜底：
 * ① 确定性登录（0 次大模型调用）：LOGIN_USERNAME_SELECTOR / LOGIN_PASSWORD_SELECTOR /
 *    LOGIN_BUTTON_SELECTOR 三个都配齐后启用，用 Playwright fill/click 直接登录，几乎瞬时完成；
 *    可配 LOGIN_AGREEMENT_SELECTOR 勾选"同意协议"类复选框；登录成功与否用
 *    LOGIN_SUCCESS_SELECTOR（或 URL 离开登录页 / 登录表单消失）确定性判断。
 * ② AI 登录（兜底）：选择器缺失、失效或登录结果无法确认时，回退到 agent.aiAct()
 *    让大模型"看图登录"，保证页面改版也能跑。
 */
export async function doLogin(page: Page, agent: PlaywrightAgent, cfg: AppConfig, logger: Logger) {
  if (!cfg.loginEnabled) {
    logger.info('统一登录：已禁用（LOGIN_ENABLED=false），跳过');
    return;
  }
  if (!cfg.loginUrl) {
    logger.warn('统一登录：未配置 LOGIN_URL，跳过');
    return;
  }

  // ① 确定性登录：三个选择器都配齐才走（全程 0 次大模型调用）
  if (cfg.loginUsernameSelector && cfg.loginPasswordSelector && cfg.loginButtonSelector) {
    const ok = await tryDeterministicLogin(page, cfg, logger);
    if (ok) {
      logger.pass('统一登录完成（确定性选择器，未调用大模型）');
      return;
    }
  }

  // ② 回退 AI 登录（原有逻辑）：确定性选择器缺失/失效时由大模型看图登录
  logger.info(`统一登录（AI）：打开 ${cfg.loginUrl}`);
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // 把 {username} / {password} 占位符替换成 .env 里的实际账号密码
  const instruction = cfg.loginSteps
    .replaceAll('{username}', cfg.loginUsername || '')
    .replaceAll('{password}', cfg.loginPassword || '');
  logger.info(`统一登录指令：${instruction}`);

  await agent.aiAct(instruction);

  if (cfg.loginAssert) {
    await agent.aiAssert(cfg.loginAssert);
  }
  logger.pass('统一登录完成（AI）');
}

/**
 * 确定性登录：用 CSS 选择器 + page.fill/click 直接登录，0 次大模型调用。
 * 返回 true = 已确认登录成功；false = 失败或无法确认（由调用方回退 AI）。
 */
async function tryDeterministicLogin(page: Page, cfg: AppConfig, logger: Logger): Promise<boolean> {
  const { loginUsernameSelector, loginPasswordSelector, loginButtonSelector } = cfg;
  if (!cfg.loginUsername || !cfg.loginPassword) {
    logger.warn('确定性登录：未配置 LOGIN_USERNAME / LOGIN_PASSWORD，回退 AI 登录');
    return false;
  }

  logger.info(`统一登录：打开 ${cfg.loginUrl}`);
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // 每步自动等待选择器出现（最长 15 秒）。元素没找到/匹配到多个会抛错 → 回退 AI
  const STEP_TIMEOUT = 15_000;
  try {
    await page.fill(loginUsernameSelector, cfg.loginUsername, { timeout: STEP_TIMEOUT });
    await page.fill(loginPasswordSelector, cfg.loginPassword, { timeout: STEP_TIMEOUT });
    // 可选：勾选"同意协议"类复选框（有的登录页不勾就点登录没反应）
    if (cfg.loginAgreementSelector) {
      const isChecked = await page.isChecked(cfg.loginAgreementSelector).catch(() => false);
      if (!isChecked) {
        await page.click(cfg.loginAgreementSelector, { force: true, timeout: STEP_TIMEOUT });
      }
    }
    await page.click(loginButtonSelector, { timeout: STEP_TIMEOUT });
  } catch (e: any) {
    logger.warn(`确定性登录：填写/点击失败（${e?.message}），回退 AI 登录`);
    return false;
  }

  // 确认是否真的登录成功（不调大模型）：优先 LOGIN_SUCCESS_SELECTOR，其次 URL 离开登录页 / 登录表单消失
  if (await waitLoggedIn(page, cfg)) {
    return true;
  }

  // 登录结果无法确认（可能是 SPA/XHR 登录，URL 和表单都判断不到）：刷新页面复查
  logger.info('确定性登录：结果未确认，刷新页面复查...');
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  const stillOnLogin = await waitForSelectorQuiet(page, loginUsernameSelector, 3_000);
  if (!stillOnLogin) {
    logger.info('确定性登录：刷新后确认已进入系统');
    return true;
  }
  logger.warn('确定性登录：登录结果未确认，回退 AI 登录');
  return false;
}

/** 确定性判断是否已登录：优先 LOGIN_SUCCESS_SELECTOR，其次 URL 离开登录页或登录表单消失。 */
async function waitLoggedIn(page: Page, cfg: AppConfig): Promise<boolean> {
  const VERIFY_TIMEOUT = 20_000;
  try {
    if (cfg.loginSuccessSelector) {
      await page.waitForSelector(cfg.loginSuccessSelector, { state: 'visible', timeout: VERIFY_TIMEOUT });
      return true;
    }
    await page.waitForFunction(
      (arg: { loginUrl: string; usernameSelector: string }) => {
        const href = window.location.href;
        const formGone = arg.usernameSelector ? !document.querySelector(arg.usernameSelector) : true;
        return href !== arg.loginUrl || formGone;
      },
      { loginUrl: cfg.loginUrl, usernameSelector: cfg.loginUsernameSelector },
      { timeout: VERIFY_TIMEOUT },
    );
    return true;
  } catch {
    return false;
  }
}

/** 等待选择器出现，超时静默返回 false（不抛错）。 */
async function waitForSelectorQuiet(page: Page, selector: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
