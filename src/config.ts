import path from 'path';
import dotenv from 'dotenv';

// 项目根目录（src 的上一级）
const projectRoot = path.resolve(__dirname, '..');

// 加载项目根目录的 .env
dotenv.config({ path: path.join(projectRoot, '.env') });

// Midscene 1.10.9 认可的模型家族（源码 MODEL_FAMILY_VALUES）
const VALID_MODEL_FAMILIES = [
  'doubao-vision',
  'doubao-seed',
  'gemini',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3',
  'qwen3.5',
  'qwen3.6',
  'vlm-ui-tars',
  'vlm-ui-tars-doubao',
  'vlm-ui-tars-doubao-1.5',
  'glm-v',
  'auto-glm',
  'auto-glm-multilingual',
  'gpt-5',
  'kimi',
  'kimi3',
  'xiaomi-mimo',
];

export interface AppConfig {
  // ① 大模型配置
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmModelFamily: string;
  // ② 待执行用例列表
  yamlFiles: string[];
  // ③ 环境参数
  baseUrl: string;
  loginEnabled: boolean;
  loginUrl: string;
  loginUsername: string;
  loginPassword: string;
  loginSteps: string;
  loginAssert: string;
  /** 确定性登录：用户名 / 密码 / 登录按钮的 CSS 选择器（三个都配齐才启用，0 次大模型调用） */
  loginUsernameSelector: string;
  loginPasswordSelector: string;
  loginButtonSelector: string;
  /** 登录前需要勾选的复选框（如"同意用户协议"），可选，配了才勾 */
  loginAgreementSelector: string;
  /** 登录成功标记（CSS 选择器，登录后才会出现的元素，如头像/用户名）。留空则用 URL/登录表单消失判断 */
  loginSuccessSelector: string;
  fullscreen: boolean;
  continueOnFailure: boolean;
  enableLog: boolean;
  dryRun: boolean;
  /** 用例失败自动重试次数（RETRY_TIMES，默认 3），降低 AI 偶发失败影响 */
  retryTimes: number;
  // ④ PlaywrightAgent 构造参数（对齐官方 WebPageAgentOpt = AgentOpt & WebPageOpt，
  //    全部见 https://midscenejs.com/ 与已安装 @midscene/web 源码）
  agentGroupName: string;
  agentReportFileName: string;
  agentReportGenerate: boolean;
  agentPersistExecutionDump: boolean;
  agentReplanningCycleLimit: number;
  agentWaitAfterAction: number;
  agentWaitForNavigationTimeout: number;
  agentWaitForNetworkIdleTimeout: number;
  agentForceSameTabNavigation: boolean;
  agentForceChromeSelectRendering: boolean;
  /** Playwright 原生变量 PW_TEST_SCREENSHOT_NO_FONTS_READY（国内网络下防字体加载截图超时） */
  pwNoFontsReady: boolean;
  // 路径
  projectRoot: string;
  testCaseDir: string;
  runDir: string;
}

export function loadConfig(): AppConfig {
  const llmModelFamily = env('LLM_MODEL_FAMILY', 'qwen3');
  // 提前校验模型家族：Midscene 会因非法值直接抛错，这里先给出清晰的中文提示
  if (llmModelFamily && !VALID_MODEL_FAMILIES.includes(llmModelFamily)) {
    throw new Error(
      `LLM_MODEL_FAMILY 取值「${llmModelFamily}」无效。合法的模型家族：${VALID_MODEL_FAMILIES.join('、')}。` +
        `（qwen3.7-plus 用 qwen3，详见 https://midscenejs.com/zh/model-common-config ）`,
    );
  }
  return {
    llmBaseUrl: env('LLM_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    llmApiKey: env('LLM_API_KEY', ''),
    llmModel: env('LLM_MODEL', 'qwen3.7-plus'),
    llmModelFamily,
    yamlFiles: (process.env.YAML_FILES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    baseUrl: env('BASE_URL', ''),
    loginEnabled: boolEnv('LOGIN_ENABLED', true),
    loginUrl: env('LOGIN_URL', process.env.BASE_URL || ''),
    loginUsername: env('LOGIN_USERNAME', ''),
    loginPassword: env('LOGIN_PASSWORD', ''),
    loginSteps: env('LOGIN_STEPS', '使用用户名 {username}，密码 {password} 完成登录'),
    loginAssert: env('LOGIN_ASSERT', ''),
    loginUsernameSelector: env('LOGIN_USERNAME_SELECTOR', ''),
    loginPasswordSelector: env('LOGIN_PASSWORD_SELECTOR', ''),
    loginButtonSelector: env('LOGIN_BUTTON_SELECTOR', ''),
    loginAgreementSelector: env('LOGIN_AGREEMENT_SELECTOR', ''),
    loginSuccessSelector: env('LOGIN_SUCCESS_SELECTOR', ''),
    fullscreen: boolEnv('FULLSCREEN', false),
    continueOnFailure: boolEnv('CONTINUE_ON_FAILURE', false),
    enableLog: boolEnv('ENABLE_LOG', true),
    dryRun: boolEnv('DRY_RUN', false),
    retryTimes: numEnv('RETRY_TIMES', 3),
    // ④ PlaywrightAgent 参数（默认值对齐官方源码 DEFAULT_* 常量 / AgentOpt 默认）
    agentGroupName: env('AGENT_GROUP_NAME', 'AI 自动化测试'),
    agentReportFileName: env('AGENT_REPORT_FILE_NAME', 'autotest'),
    agentReportGenerate: boolEnv('AGENT_REPORT_GENERATE', true),
    agentPersistExecutionDump: boolEnv('AGENT_PERSIST_EXECUTION_DUMP', false),
    agentReplanningCycleLimit: numEnv('AGENT_REPLANNING_CYCLE_LIMIT', 30),
    agentWaitAfterAction: numEnv('AGENT_WAIT_AFTER_ACTION', 300),
    agentWaitForNavigationTimeout: numEnv('AGENT_WAIT_FOR_NAVIGATION_TIMEOUT', 5000),
    agentWaitForNetworkIdleTimeout: numEnv('AGENT_WAIT_FOR_NETWORK_IDLE_TIMEOUT', 2000),
    agentForceSameTabNavigation: boolEnv('AGENT_FORCE_SAME_TAB_NAVIGATION', false),
    agentForceChromeSelectRendering: boolEnv('AGENT_FORCE_CHROME_SELECT_RENDERING', true),
    pwNoFontsReady: boolEnv('PW_TEST_SCREENSHOT_NO_FONTS_READY', true),
    projectRoot,
    testCaseDir: path.join(projectRoot, 'test_case'),
    runDir: path.join(projectRoot, 'midscene-run'),
  };
}

/**
 * 把 .env 里的友好键（LLM_*）映射成 Midscene 需要的环境变量。
 * 必须在创建 PlaywrightAgent 之前调用。
 */
export function applyMidsceneEnv(cfg: AppConfig) {
  process.env.MIDSCENE_MODEL_BASE_URL = cfg.llmBaseUrl;
  process.env.MIDSCENE_MODEL_API_KEY = cfg.llmApiKey;
  process.env.MIDSCENE_MODEL_NAME = cfg.llmModel;
  process.env.MIDSCENE_MODEL_FAMILY = cfg.llmModelFamily;
  process.env.MIDSCENE_RUN_DIR = cfg.runDir;
  // Playwright 原生变量：跳过字体加载就绪检查，避免截图等待字体超时（国内网络常用）
  if (cfg.pwNoFontsReady) {
    process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  } else {
    delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
  }
}

function env(key: string, def: string): string {
  const v = process.env[key];
  return v === undefined || v.trim() === '' ? def : v.trim();
}

function boolEnv(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function numEnv(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
