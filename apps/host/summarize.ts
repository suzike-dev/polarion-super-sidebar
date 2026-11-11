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
      '必须严格使用下面的 Markdown 结构，不要自由发挥：',
      '## 结论',
      '- 一句话结论，不超过 50 字。',
      '- 可再补一句影响范围，例如涉及哪些模块或评审角色。',
      '## 变更要点',
      '### 第X章 章节名（数据里给出的真实章节名，如“第3章 功能需求”；没有名字才允许只写“第X章”）',
      '- **工作项编号 标题**（所属功能单元，如“3.7 执行及辅助状态输出选择”）：变更点（参数/条目：旧 → 新）',
      '## 影响提示',
      '- 1 到 3 条，说明研发、测试或评审需要关注的地方。',
      '',
      '要求：',
      '1. 每个要点只占一行，不超过 80 字；只写变更点，不要整段摘抄原文。',
      '2. 章节标题必须带真实章节名（数据“章节：”行与各条目的“所属功能单元”里有）；小节写到编号+名称，如“3.7 执行及辅助状态输出选择”。',
      '3. 按章节归并，最多 8 条要点；同类变更合并描述。',
      '4. 没有内容的章节不要写；不要输出代码块、HTML 或表格。',
      '5. 只依据给定数据，不编造未出现的需求、数字、人名、章节名或结论。',
      '6. 如果变更里包含表格，用“表格内容调整”概括，不要尝试重建表格。',
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
