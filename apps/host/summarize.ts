import {query} from '@anthropic-ai/claude-agent-sdk';
import {CLAUDE, ROOT} from './paths.ts';

/**
 * 变更总结是一次性、无工具的短对话：
 * - 不读取项目设置、不加载 MCP/Skills，避免把需求内容带到无关工具；
 * - 只依据 Host 已经算好的结构化摘要，不重新读取 Polarion；
 * - 失败时由调用方保留启发式总结，不阻塞变更记录写入。
 */
export async function summarizeChange(input: {
  documentTitle: string;
  baselineAt: number;
  endedAt: number;
  digest: string;
  model?: string;
}): Promise<{text: string; model: string}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let stream: ReturnType<typeof query> | undefined;
  try {
    const prompt = [
      '请根据下面的结构化变更数据，写一份供飞书群快速扫读的中文需求变更说明。',
      '',
      '输出示例（结构必须完全一致，内容按数据替换）：',
      '## 结论',
      '- 共变更 12 个工作项，集中在电池冷却阈值与快充请求。',
      '- 涉及热管理与 HMI，测试基线需同步复核。',
      '## 变更要点',
      '### 第3章 功能需求',
      '- **REQ-1042 电池冷却请求**（第3章 功能需求 · 3.2 热管理请求）：请求阈值 45°C → 50°C，迟滞 2°C → 3°C。',
      '- **REQ-1051 快充冷却**（第3章 功能需求 · 3.2 热管理请求）：快充预热由“关闭”改为“按需开启”。',
      '### 第4章 HMI 显示',
      '- **REQ-1120 冷却状态显示**（第4章 HMI 显示 · 4.1 状态图标）：新增“降级”图标。',
      '## 影响提示',
      '- 阈值变化影响台架判定边界，历史用例需更新。',
      '',
      '硬性格式规则（违反即错误）：',
      '1. 章节标题必须是“第N章 名称”，其中名称从数据“章节：”行或条目“所属功能单元”里原样复制；数据没有名称时才允许只写“第N章”。禁止输出裸的“第N章”。',
      '2. 每条要点必须以 **编号 标题**（所属功能单元：第N章 名称 · 小节号 小节名）开头，功能单元从条目“所属功能单元”原样复制；条目没有功能单元时省略括号。',
      '3. 冒号后写变更点（参数/条目：旧 → 新），每条不超过 80 字，不整段摘抄。',
      '4. 按章节归并，最多 8 条要点；同类变更合并描述；没有内容的章节不要写。',
      '5. 不要输出代码块、HTML 或表格；表格变更用“表格内容调整”概括。',
      '6. 只依据给定数据，不编造未出现的需求、数字、人名、章节名或结论。',
      '',
      `文档：${input.documentTitle}`,
      `区间：${new Date(input.baselineAt).toLocaleString('zh-CN', {hour12: false})} → ${new Date(input.endedAt).toLocaleString('zh-CN', {hour12: false})}`,
      '',
      input.digest,
    ].join('\n');

    stream = query({
      prompt,
      options: {
        cwd: ROOT,
        pathToClaudeCodeExecutable: CLAUDE,
        executable: 'node',
        // 必须加载用户级设置：认证方式和可用模型都在其中；空数组会让 CLI 退回到已过期的 OAuth 会话。
        settingSources: ['user'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        mcpServers: {},
        allowedTools: [],
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'NotebookEdit', 'BashOutput', 'KillShell'],
        includePartialMessages: false,
        abortController: controller,
        systemPrompt: {type: 'preset', preset: 'claude_code', append: '只做中文需求变更总结，只依据用户给出的结构化数据写作，不调用任何工具，不编造事实。'},
        ...(input.model ? {model: input.model} : {}),
      },
    });

    let text = '';
    let model = input.model ?? '';
    for await (const message of stream) {
      if (message.type === 'system' && message.subtype === 'init') model = message.model || model;
      if (message.type === 'assistant' && !message.parent_tool_use_id) {
        for (const block of message.message.content) if (block.type === 'text') text += block.text;
      }
      if (message.type === 'result') {
        if (message.subtype !== 'success') throw Error('AI_SUMMARY_FAILED');
        if (typeof message.result === 'string' && message.result.trim()) text = message.result;
      }
    }
    const cleaned = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (cleaned.length < 20) throw Error('AI_SUMMARY_EMPTY');
    return {text: cleaned.slice(0, 8000), model};
  } catch (error) {
    if (controller.signal.aborted) throw Error('AI_SUMMARY_TIMEOUT');
    const message = error instanceof Error ? error.message : String(error);
    if (/^AI_SUMMARY_[A-Z_]+$/.test(message)) throw error;
    throw Error('AI_SUMMARY_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    try { stream?.close(); } catch { /* 已结束 */ }
  }
}
