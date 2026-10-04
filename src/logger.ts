import fs from 'fs';
import path from 'path';

/**
 * 运行日志：实时打印到控制台，同时追加写入 midscene-run/logs/run.log。
 * ENABLE_LOG=false 时关闭全部日志。
 */
export class Logger {
  private enabled: boolean;
  private logFile: string;

  constructor(enabled: boolean, logDir: string) {
    this.enabled = enabled;
    this.logFile = path.join(logDir, 'run.log');
    if (enabled) fs.mkdirSync(logDir, { recursive: true });
  }

  log(msg: string) {
    if (!this.enabled) return;
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
    console.log(line);
    fs.appendFileSync(this.logFile, line + '\n');
  }

  info(msg: string) { this.log(`[INFO] ${msg}`); }
  step(msg: string) { this.log(`[STEP] ${msg}`); }
  pass(msg: string) { this.log(`[PASS] ${msg}`); }
  fail(msg: string) { this.log(`[FAIL] ${msg}`); }
  warn(msg: string) { this.log(`[WARN] ${msg}`); }
}
