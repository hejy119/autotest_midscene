# autotest_midscene — YAML 驱动的 AI 自动化测试框架

**测试人员不需要写任何代码**，只需在 `test_case/` 目录下用 **YAML 自然语言**描述用例，框架自动：
`启动浏览器 → Midscene AI 统一登录 → 逐条执行用例 → 生成 HTML 报告`。

底层是 **Playwright + Midscene**（视觉 AI 自动化），操作和断言全部由大模型"看懂页面后"完成，
**页面元素改版也不影响用例**（不依赖选择器）。

> **关于示例用例**：本仓库只包含使用**公开演示站点**（saucedemo、百度）的示例用例，
> 实际业务系统的用例与测试数据未包含在内。换成自己的系统只需改 `.env` 的 `BASE_URL` 和 `LOGIN_*`。

---

## 一、快速开始（首次搭建）

```bash
# 1. 安装依赖
npm install

# 2. 复制配置并填写大模型 API Key
copy .env.example .env
#   编辑 .env，把 LLM_API_KEY 换成你的 key（阿里云百炼控制台申请：https://bailian.console.aliyun.com/）

# 3. 跑 AI 测试（等价于：双击 run.bat / VS Code 按 F5）
npm run ai:test
```

> 没有 API Key 时想先试试框架：`npm run ai:dry`（只校验 YAML 写法，不启动浏览器、不调大模型）。

---

## 二、日常使用（每次只需 3 步）

换被测系统、加用例，全程不用写代码：

1. **改 `.env` 两处**
   - `BASE_URL=被测系统网址`
   - `YAML_FILES=要跑的用例文件`（逗号分隔，**留空 = 跑 `test_case/` 下全部**）
   - 被测系统要登录时，顺手填 `LOGIN_ENABLED=true` 和 `LOGIN_USERNAME` / `LOGIN_PASSWORD` 等
2. **把用例写进 `test_case/` 目录**（`.yaml` 文件，写法见第五节）
3. **一键运行**（任意一种）
   - 双击 `run.bat`，或
   - 在 VS Code 里打开本文件夹 → 按 **F5**，或
   - 右键 `src/index.ts` → **Run Code**
4. **打开报告** `midscene-run/report/index.html` 查看通过/失败/失败截图

**推荐习惯**：写新用例 → 先 **DRY RUN 只校验格式**（不花 token）→ 再正式跑。

---

## 三、目录结构

```
autotest_midscene/
├── src/                    # ★ 框架底层代码（测试人员不要动）
│   ├── index.ts            # ★ 入口：整个执行流程（F5 / 右键 / 命令行直接跑）
│   ├── config.ts           #   读取 .env 配置，注入 Midscene 环境变量
│   ├── logger.ts           #   实时日志 → midscene-run/logs/run.log
│   ├── yaml-loader.ts      #   扫描并解析 test_case/ 下的 YAML 用例
│   ├── login.ts            #   框架内置统一登录（确定性选择器优先，AI 兜底）
│   ├── runner.ts           #   逐条执行用例，失败处理，失败截图
│   └── report.ts           #   生成 HTML 报告
├── test_case/              # ★ 测试用例存放处（纯 YAML，无任何代码）
│   └── 示例/               #   示例用例（公开演示站点，可直接跑）
│       ├── 示例.yaml       #   四种写法演示（saucedemo）
│       └── 百度试用.yaml   #   无登录试用样例
├── midscene-run/           # ★ 自动生成：日志 + HTML 报告（不用手动维护）
│   ├── logs/run.log
│   └── report/
│       ├── index.html      #   自定义报告（通过/失败/耗时/失败截图，打开即看）
│       └── autotest.html   #   Midscene 官方报告（每步 AI 推理细节，排障用）
├── .env                    # ★ 全局配置（大模型 / 用例列表 / 环境参数 / Agent 参数）
├── run.bat                 # Windows 双击运行入口
├── .vscode/                #   F5 调试运行、右键运行（Code Runner）的配置
└── package.json
```

---

## 四、.env 配置（4 类）

| 分类 | 变量 | 说明 |
|---|---|---|
| ① 大模型 | `LLM_BASE_URL` | 阿里云百炼兼容地址（默认已填） |
| | `LLM_API_KEY` | 你的 API Key（**必填**） |
| | `LLM_MODEL` / `LLM_MODEL_FAMILY` | 模型名 / 系列，默认 `qwen3.7-plus` / `qwen3`（**family 必填且不能乱写**，写错会报 `Invalid MIDSCENE_MODEL_FAMILY`） |
| ② 用例列表 | `YAML_FILES` | 留空=跑全部；指定=只跑列出的文件（逗号分隔） |
| ③ 环境参数 | `BASE_URL` | 被测系统地址（**每次换系统要改**） |
| | `LOGIN_*` | 统一登录：开关 / 地址 / 账号 / 密码 / AI 指令 / 断言 / **确定性登录选择器**（见下） |
| | `FULLSCREEN` | `true`=有头全屏窗口（方便看 AI 操作），`false`=无头静默 |
| | `CONTINUE_ON_FAILURE` | 失败后是否继续后面的用例 |
| | `RETRY_TIMES` | 用例失败自动重试次数（默认 3），AI 偶发失败时自动重跑，降低假报错 |
| | `ENABLE_LOG` | 是否写运行日志 |
| | `DRY_RUN` | `true`=只校验 YAML，不真正执行 |
| ④ Agent 参数 | `AGENT_*` | Midscene Agent 构造参数（超时/等待/报告，默认已对齐官方，一般不用改） |
| | `AGENT_REPORT_FILE_NAME` | 官方报告文件名，默认 `autotest` |
| | `AGENT_FORCE_CHROME_SELECT_RENDERING` | `true`=修复原生 select 下拉框点不到（默认开） |
| | `AGENT_FORCE_SAME_TAB_NAVIGATION` | `true`=强制同页签跳转（拦截新开页签，默认关） |
| | `AGENT_WAIT_AFTER_ACTION` / `AGENT_REPLANNING_CYCLE_LIMIT` | 动作后等待 / aiAct 最大重规划次数 |
| | `PW_TEST_SCREENSHOT_NO_FONTS_READY` | Playwright 截图跳过字体加载就绪检查（国内网络防超时，默认开） |

> `LLM_MODEL_FAMILY` 可选值（框架已内置校验）：`qwen3`（qwen3.x 系列）、`qwen2.5-vl`、`qwen3-vl`、`qwen3.5`、`qwen3.6`、`doubao-vision`、`doubao-seed`、`gemini`、`glm-v`、`kimi`、`gpt-5` 等，详见 [Midscene 模型配置](https://midscenejs.com/zh/model-common-config)。

### 登录提速：确定性登录（强烈建议配置）

统一登录默认由**大模型"看图登录"**（`aiAct`），登录页如果步骤多，一轮轮截图推理会耗时 **60~90 秒**。
只要在 `.env` 配齐下面 **4 个选择器**，登录就改为 **Playwright 直接 fill/click**，**0 次大模型调用，约 5 秒完成**：

| 变量 | 说明 |
|---|---|
| `LOGIN_USERNAME_SELECTOR` | 用户名输入框 CSS 选择器 |
| `LOGIN_PASSWORD_SELECTOR` | 密码输入框 CSS 选择器 |
| `LOGIN_BUTTON_SELECTOR` | 登录按钮 CSS 选择器 |
| `LOGIN_AGREEMENT_SELECTOR` | （可选）登录前需勾选的复选框，如"同意协议"，没有就留空 |
| `LOGIN_SUCCESS_SELECTOR` | （可选）登录成功后才会出现的元素，用于确认登录完成，留空则用 URL 变化判断 |

> 选择器从浏览器 **F12 → Elements → 右键 Copy Selector** 获取。配了但失效（页面改版）时，框架**自动回退到 AI 登录**，不会跑挂。
> **注意**：选择器值必须以**单引号包住**（如 `'#user-name'`）——项目用 dotenv 读 `.env`，值里开头的 `#`（CSS id 选择器）会被当成注释截断，不引号包住会静默变成空值、退回 AI 登录。
> 选择器配好后填进 `.env` 即生效，登录提速无需改动任何代码。

---

## 五、YAML 用例写法

文件顶部就是一个用例**列表**，`- name:` 定义用例名。登录**永远不用写**（框架统一处理，且配好 `LOGIN_*_SELECTOR` 后登录只需 ~5 秒，见第四节）。

### 写法 ① 基础格式（对应 Excel 的「操作步骤 / 预期结果」）

```yaml
- name: 进入商品列表
  ai: 进入商品列表页面，等待页面加载完成
  aiAssert: 页面显示 Products 标题
```

`ai` 写操作步骤（对应 Excel 操作步骤）、`aiAssert` 写预期结果（对应 Excel 预期结果）。**都可以写多条**：

```yaml
- name: 把第一件商品加入购物车
  ai:
    - 点击第一个商品的 Add to cart 按钮
    - 等待购物车徽标出现
  aiAssert:
    - 右上角购物车徽标显示数字 1
    - 页面没有报错提示
```

> **从 Excel 测试用例转 YAML**：测试步骤每行 → `ai`，预期结果每行 → `aiAssert`，去掉行首编号（如 `1. 查看左侧边栏` → `ai: 查看左侧边栏`）。登录由框架统一处理，不用写；前置条件只作为行首注释标注。参考 `test_case/示例/示例.yaml` 里的「① 基础格式」。

### 写法 ② steps 格式（动作名沿用 Midscene Agent 的方法名）

`steps:` 这个键和文件结构（顶层直接是用例数组）由本项目定义；但**步骤的动作名直接沿用 Midscene Agent 的方法名**（camelCase），额外参数作为兄弟键——熟悉 Midscene 的话可以直接上手：

> 本项目走的是 **Midscene 的 JS API**，上面的 YAML 是自研的一层封装。
> （Midscene 官方另有 YAML 脚本链路：旧版用 `tasks:` / `flow:`，**已进入维护状态**；新版 Midscene Test 用 `cases:` / `steps:`，目前 Beta。）

```yaml
- name: 完成一次购物流程
  steps:
    - ai: 点击第一个商品的 Add to cart 按钮        # 通用指令，AI 自己规划
    - aiAssert: 购物车徽标显示数字 1
    - aiInput: 用户名输入框                        # 精确定位输入
      value: standard_user
    - aiTap: 登录按钮                              # 精确点击
    - aiWaitFor: 页面出现 Products 标题            # 等待条件成立
      timeout: 15000                              # 可选：超时毫秒
    - aiScroll: 商品列表                           # 精确滚动（距离）
      direction: down
      distance: 300
    - aiScroll: 商品列表                           # 滚动到页底（官方 scrollType）
      scrollType: scrollToBottom
    - aiQuery: 购物车里有几个商品？                 # 提取数据（结果进日志）
    - recordToReport: 本步验证了加购流程            # 往报告记录备注
    - sleep: 1000                                 # 等待 1000 毫秒
```

### 支持的全部动作

| 类别 | 步骤键 | 对应方法 | 说明 |
|---|---|---|---|
| 通用 | `ai:` / `aiAct:` / `instruction:` | `aiAct` | AI 自己规划动作，日常最常用 |
| 精确动作 | `aiTap: 定位` | `aiTap` | 点击 |
| | `aiInput: 定位` + `value:` | `aiInput` | 输入（也可 `aiInput: 值` + `locate:`） |
| | `aiKeyboardPress: 定位` + `keyName:` | `aiKeyboardPress` | 按键 |
| | `aiScroll: 定位` + `direction:` + `distance:` | `aiScroll` | 滚动 |
| | `aiScroll: 定位` + `scrollType:` | `aiScroll` | 滚动类型：`scrollToBottom` / `scrollToTop` / `scrollToRight` / `scrollToLeft` / `singleAction`（或旧别名 `once` / `untilBottom` 等） |
| | `aiHover:` / `aiRightClick:` / `aiDoubleClick:` / `aiLongPress:` / `aiClearInput:` | 同名 | 悬停 / 右键 / 双击 / 长按 / 清空输入 |
| | `aiPinch: 定位` + `direction: in/out` | `aiPinch` | 捏合 |
| 断言查询 | `aiAssert: 断言` + `errorMessage:` | `aiAssert` | 断言，不符则失败 |
| | `aiWaitFor: 条件` + `timeout:`（毫秒） | `aiWaitFor` | 等待条件成立 |
| | `aiQuery:` / `aiAsk:` / `aiLocate:` | `aiQuery` 等 | 提取数据 / 提问 / 定位（结果进日志） |
| | `aiBoolean:` / `aiNumber:` / `aiString:` | `aiBoolean` 等 | 提取布尔 / 数字 / 文本 |
| 报告 | `recordToReport: 标题` + `content:` | `recordToReport` | 往报告记备注 |
| | `logScreenshot: 标题` | `recordToReport` | 同上（旧名） |
| 脚本 | `javascript: 代码` | `evaluateJavaScript` | 执行 JS（结果进日志） |
| | `runGherkinScenario: 文本` | `runGherkinScenario` | 跑 Gherkin 场景 |
| 辅助 | `url: 地址` | — | 直接跳转（框架独有） |
| | `sleep: 毫秒` | — | 等待（**毫秒**，官方单位） |
| | `log: 文字` | — | 打日志（框架独有） |

> - `ai`（aiAct）是万能指令：写「把第一件商品加入购物车」AI 会自动完成；其余是精确控制，需要强控制时才用。
> - 步骤键必须用官方 camelCase（`aiAssert` 不是 `ai assert`），写错会提示正确的官方写法。
> - **提效**：核心用例尽量用精确指令（`aiTap` / `aiInput` / `aiAssert`）而非大段自然语言，实测能省约一半 Token、耗时减半。

---

## 六、运行方式

| 方式 | 操作 | 适用场景 |
|---|---|---|
| **双击 `run.bat`** | 项目根目录双击 | ⭐ 最省事，自动处理便携 node 路径和字体环境变量 |
| **VS Code 按 F5** | 用 VS Code 打开本文件夹，按 F5 | 日常开发/调试，可打断点（需装好便携 node，已配置） |
| **右键 Run Code** | 右键 `src/index.ts` → Run Code | 需装 Code Runner 扩展（配置已写好） |
| `npm run ai:test` | 终端执行 | 命令行习惯 |
| `npm run ai:dry` | 终端执行 | 只校验 YAML，不花 token |

**DRY RUN（只校验 YAML 格式）有 3 种触发方式**：
1. `npm run ai:dry`
2. F5 → 调试面板下拉框选 **"▶ DRY RUN 只校验 YAML"** 配置
3. 把 `.env` 里 `DRY_RUN=true`（验完记得改回 `false`）

> 换了 `.env` 的 `YAML_FILES` 或新增用例后，**先 DRY RUN 验一遍格式再正式跑**，能避免写到一半发现 YAML 写错。

---

## 七、测试报告

跑完自动生成在 `midscene-run/report/`，**两份报告互相链接**：

| 报告 | 文件 | 看什么 |
|---|---|---|
| 自定义报告 | `index.html` | **左侧导航 + 总览**：侧边栏列出总览/各目录文件（有失败的目录用红色标记），顶部总览含 汇总卡+**总耗时**+整体通过率，下方按 **目录 → 文件 → 用例** 树形展示（可折叠）+ 每目录统计卡 + 每条用例每步的 通过/失败/耗时/**失败截图**，打开即看 |
| Midscene 官方报告 | `autotest.html` | 每一步的 **AI 推理细节**（thought/截图/命中元素），用例失败时排查 AI 为什么做错 |

> 自定义报告：点左侧导航项会**平滑滚动**到对应位置并高亮当前项，不用一屏屏往下翻；有失败用例的目录/文件在侧边栏显示红色并带失败数徽标。侧边栏的**目录、文件都可折叠/展开（默认全部展开）**，每个文件下**列出该文件的全部用例名**（每条标注 ✅ 通过 / ❌ 失败），点任意一条直接跳到该用例，且**只有那一条用例高亮描边**，点下一条才切换。内容区目录/文件标题同样可折叠。`test_case/` 下的**子目录**也会被自动扫描并作为独立目录统计（如按模块建 `作业/`、`示例/` 子目录后，报告会按模块分组展示）。
>
> 官方报告必须调 `agent.destroy()` 才会落定，框架已自动处理。不需要官方报告时可设 `AGENT_REPORT_GENERATE=false`（但不建议，会失去排障信息）。

---

## 八、执行流程

```
load .env ──▶ 扫描 test_case 统计用例数 ──▶ 启动浏览器
   └──▶ 创建 Midscene Agent（接入大模型，参数来自 AGENT_*）
   └──▶ 统一登录（.env 的 LOGIN_* 驱动，用例里不写；配了 LOGIN_*_SELECTOR 则确定性登录，否则 AI）
   └──▶ 逐条执行用例（实时日志；失败自动重试 RETRY_TIMES 次，再按 CONTINUE_ON_FAILURE 处理并截图）
   └──▶ agent.destroy() 收尾官方报告（report/autotest.html）
   └──▶ 生成自定义 HTML 报告（report/index.html，页脚链接官方报告）
   └──▶ 关闭浏览器 ──▶ 汇总通过/失败，有失败时退出码为 1
```

---

## 九、常见问题（FAQ）

**Q1. 按 F5 弹「Java Language Server client: couldn't create connection to server」？**
与框架无关。是电脑上装的老扩展 **`Java Language Support`（georgewfraser.vscode-javac）** 在调试（`onDebug`）时激活崩溃。你已装有官方 **Extension Pack for Java**，直接**卸载/禁用**那个老扩展即可（扩展面板搜 "Java Language Support" → 右键 → 卸载）。

**Q2. 报「未配置 LLM_API_KEY」？**
`.env` 里 `LLM_API_KEY` 没填或为空，去阿里云百炼控制台申请后填入。也可以先用 `npm run ai:dry` 校验用例。

**Q3. 报 `Invalid MIDSCENE_MODEL_FAMILY`？**
`LLM_MODEL_FAMILY` 写错了。`qwen3.7-plus` 用 `qwen3`；可选值见第四节末尾，写错会在启动时给出合法值清单。

**Q4. 报「未知动作」？**
YAML 里步骤键写错（可能用了 `ai assert` 这种带空格写法）。框架会提示正确的 camelCase，例如 `ai assert` → `aiAssert`。

**Q5. 找不到测试？（VS Code 测试面板说「找不到测试」）**
本项目没有配置测试框架，**不要用左侧的测试面板**。用 F5 或右键 Run Code 或双击 run.bat 运行。

**Q6. 截图卡住/超时（等字体加载）？**
国内网络下 Playwright 截图可能卡在"等字体就绪"，框架已默认开启 `PW_TEST_SCREENSHOT_NO_FONTS_READY=1`（run.bat 和 .env 双重保障）。

**Q7. 想只跑某一条用例？**
临时把 `YAML_FILES` 指到只含该用例的文件（或新建一个只含它的 yaml），跑完改回。

**Q8. 为什么不用 Midscene 官方的 YAML 脚本 / Midscene Test？**

本项目建在 **Midscene 的 JS API** 上，上面的 YAML 是自研的一层封装。官方另有 YAML 脚本链路，但都不是本项目要的东西：

- **旧链路**（`@midscene/cli` + `tasks:` / `flow:`）——提供的是"跑一个 YAML 脚本"的能力，**已进入维护状态**（官方不再新增语法与能力）
- **新方案 Midscene Test**（`@midscene/test` + `cases:` / `steps:`）——目前是 **Beta**，官方明说"测试协议与 API 正在持续演进"，**接口不承诺兼容**

本项目需要的是**测试框架**能力——批量执行、统一登录、失败重试、汇总报告、成本控制，这些官方链路不提供或还不稳定。**建在 JS API 上更稳**：那是官方两代方案共用的底层。

> 如果未来要跟进，可以参考官方新方案的设计（生命周期钩子、Node 抽象、执行项目隔离、Node 说明书）来改进本框架。

---

## 十、踩坑记录

- 本项目用 `tsx` 直接运行 TypeScript，不需要编译，所有入口都是 `node node_modules/tsx/dist/cli.mjs src/index.ts`。若使用便携版 node（不在 PATH），需自行在 `run.bat` 或 `.vscode/launch.json` 里指定 `runtimeExecutable`。
- Chromium 下载走国内镜像：`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`
- 国内网络下截图可能卡在"等字体加载"：框架已默认开启 `PW_TEST_SCREENSHOT_NO_FONTS_READY=1`（run.bat 与 .env 双重保障），截图不再等 web 字体加载完成。
- Midscene 官方报告必须调 `agent.destroy()` 才会落定（flush + finalize），框架已在收尾自动调用。
