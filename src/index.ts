import path from 'path';
import { loadConfig, applyMidsceneEnv } from './config';
import { Logger } from './logger';
import { loadTestCases } from './yaml-loader';
import { doLogin } from './login';
import { runSuite, describeStep, CaseResult, RunSummary } from './runner';
import { generateReport } from './report';
import type { PlaywrightAgent } from '@midscene/web/playwright';

/**
 * 框架入口。
 * 流程：加载 .env → 扫描 test_case → 启动浏览器 → 创建 Midscene Agent
 *      → 统一登录 → 逐条执行用例（实时日志）→ 生成 HTML 报告 → 汇总退出
 */
async function main() {
  const cfg = loadConfig();

  // DRY_RUN：只解析用例并打印计划，不启动浏览器/不调大模型，用于校验 YAML 写法
  if (cfg.dryRun) {
    console.log('===== DRY RUN（仅校验 YAML，不执行任何 AI 操作）=====');
    let cases;
    try {
      cases = loadTestCases(cfg.testCaseDir, cfg.yamlFiles);
    } catch (e: any) {
      console.error(`❌ YAML 校验失败：${e?.message}`);
      process.exit(1);
    }
    if (cases.length === 0) {
      console.error('未找到任何用例（test_case/ 下没有 YAML 文件，或 YAML_FILES 指定的文件不存在）');
      process.exit(1);
    }
    console.log(`共发现 ${cases.length} 条用例：\n`);
    for (const tc of cases) {
      console.log(`◆ ${tc.name}（${tc.file}）`);
      tc.steps.forEach((s, i) => {
        console.log(`   ${i + 1}. [${s.action}] ${describeStep(s)}`);
      });
    }
    console.log('\nDRY RUN 通过，YAML 格式正确。配置 LLM_API_KEY 后即可正式运行。');
    return;
  }

  // 校验大模型配置
  if (!cfg.llmApiKey) {
    console.error('❌ 未配置 LLM_API_KEY，请在 .env 中填写你的大模型 API Key（阿里云百炼控制台申请）。');
    console.error('   也可以先设置 DRY_RUN=true 校验 YAML 写法。');
    process.exit(1);
  }

  // 必须在创建 Midscene Agent 前设置环境变量
  applyMidsceneEnv(cfg);

  const logger = new Logger(cfg.enableLog, path.join(cfg.runDir, 'logs'));
  const startedAt = new Date().toLocaleString('zh-CN', { hour12: false });

  logger.info('====== 框架启动 ======');
  logger.info(`大模型：${cfg.llmModel}（family: ${cfg.llmModelFamily}）`);
  logger.info(`模型地址：${cfg.llmBaseUrl}`);
  logger.info(`用例目录：${cfg.testCaseDir}`);

  // 扫描用例
  let cases: ReturnType<typeof loadTestCases>;
  try {
    cases = loadTestCases(cfg.testCaseDir, cfg.yamlFiles);
  } catch (e: any) {
    logger.fail(`用例加载失败：${e?.message}`);
    process.exit(1);
  }
  if (cases.length === 0) {
    logger.warn('未找到任何用例（test_case/ 下没有 YAML 文件，或 YAML_FILES 指定的文件不存在）');
    process.exit(1);
  }
  logger.info(`共发现 ${cases.length} 条用例`);

  // 启动浏览器
  const { chromium } = await import('playwright');
  logger.info(cfg.fullscreen ? '启动浏览器（全屏模式）...' : '启动浏览器（无头模式）...');
  const browser = await chromium.launch({
    headless: !cfg.fullscreen,
    args: cfg.fullscreen ? ['--start-maximized'] : [],
  });

  let agent: PlaywrightAgent | undefined;
  let officialReportPath: string | undefined;
  try {
    const page = await browser.newPage({
      viewport: cfg.fullscreen ? null : { width: 1280, height: 768 },
    });
    if (cfg.baseUrl) page.setDefaultNavigationTimeout(60_000);

    // 创建 Midscene PlaywrightAgent（加载大模型，参数全部由 .env 的 AGENT_* 配置）
    const { PlaywrightAgent } = await import('@midscene/web/playwright');
    agent = new PlaywrightAgent(page, {
      groupName: cfg.agentGroupName,
      reportFileName: cfg.agentReportFileName,
      generateReport: cfg.agentReportGenerate,
      persistExecutionDump: cfg.agentPersistExecutionDump,
      replanningCycleLimit: cfg.agentReplanningCycleLimit,
      waitAfterAction: cfg.agentWaitAfterAction,
      waitForNavigationTimeout: cfg.agentWaitForNavigationTimeout,
      waitForNetworkIdleTimeout: cfg.agentWaitForNetworkIdleTimeout,
      forceSameTabNavigation: cfg.agentForceSameTabNavigation,
      forceChromeSelectRendering: cfg.agentForceChromeSelectRendering,
    });

    // 统一登录（.env 配置驱动，用例里不写登录）
    await doLogin(page, agent, cfg, logger);

    // 执行所有用例
    const { results, summary } = await runSuite(page, agent, cases, logger, cfg.continueOnFailure, cfg.retryTimes);

    // 收尾官方报告：flush + finalize 必须在 destroy() 里执行，落定 reportFile
    await agent.destroy();
    if (agent.reportFile) {
      officialReportPath = agent.reportFile;
      logger.info(`Midscene 官方报告已生成：${officialReportPath}`);
    }

    // 生成自定义 HTML 报告（页脚会链接官方报告）
    const reportFile = generateReport(cfg.runDir, results, summary, startedAt, officialReportPath);
    logger.info(`测试报告已生成：${reportFile}`);

    // 汇总
    logger.info(`===== 执行汇总：共 ${summary.total} 条，通过 ${summary.passed} 条，失败 ${summary.failed} 条 =====`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    // destroy() 幂等（已 destroy 则直接返回），这里兜底保证官方报告总能落定
    if (agent) {
      try {
        await agent.destroy();
      } catch (e: any) {
        logger.warn(`Midscene Agent 关闭失败：${e?.message}`);
      }
    }
    await browser.close();
    logger.info('浏览器已关闭');
  }
}

main().catch((e: any) => {
  console.error('运行出错：', e?.message || e);
  process.exit(1);
});
