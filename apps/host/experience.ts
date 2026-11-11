import {query} from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';
import {CLAUDE, DATA, ROOT} from './paths.ts';
import type {Store} from './store.ts';
import type {ExperienceView, Run} from '../../packages/protocol/index.ts';

/** 经验按项目沉淀为本地 Markdown 文件，后续每轮注入提示词，避免重犯已被纠正的做法。 */
const safeProject = (projectId: string) => projectId.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'project';
export function experiencePath(projectId: string, dataDir = DATA) { return path.join(dataDir, 'experience', safeProject(projectId) + '.md'); }
export function readExperience(projectId: string, dataDir = DATA): ExperienceView {
  const file = experiencePath(projectId, dataDir);
  try { const stat = fs.statSync(file); return { text: fs.readFileSync(file, 'utf8'), path: file, updatedAt: Math.round(stat.mtimeMs) }; }
  catch { return { text: '', path: file, updatedAt: 0 }; }
}
export function writeExperience(projectId: string, text: string, dataDir = DATA): ExperienceView {
  const file = experiencePath(projectId, dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp'; fs.writeFileSync(temporary, text, 'utf8'); fs.renameSync(temporary, file);
  return readExperience(projectId, dataDir);
}
export function clearExperience(projectId: string, dataDir = DATA): ExperienceView {
  fs.rmSync(experiencePath(projectId, dataDir), { force: true });
  return readExperience(projectId, dataDir);
}
/** 会话记录摘要：用户请求全文 + 助手回答截断，保留最近的纠正，总量封顶。 */
export function conversationDigest(store: Store, sessionId: string, limit = 28000): string {
  const runs = store.list<Run>('run').filter(r => r.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt).slice(-40);
  const lines: string[] = [];
  for (const run of runs) {
    const rows = store.db.prepare('SELECT kind,data FROM events WHERE run_id=? ORDER BY seq').all(run.id);
    for (const row of rows) {
      const kind = String(row.kind); let data: any; try { data = JSON.parse(String(row.data)); } catch { continue; }
      if (kind === 'user' && typeof data.text === 'string' && data.text.trim()) lines.push('【用户】' + data.text.slice(0, 2000));
      else if (kind === 'result' && typeof data.text === 'string' && data.text.trim()) lines.push('【助手】' + data.text.slice(0, 1200));
    }
  }
  const digest = lines.join('\n');
  return digest.length > limit ? digest.slice(digest.length - limit) : digest;
}
/**
 * 经验沉淀是一次性、无工具的短对话（同变更总结）：
 * 只依据会话摘要与已有经验合并去重，不读取 Polarion，不调用任何工具。
 */
export async function distillExperience(input: { digest: string; existing: string; model?: string }, runtimeQuery: typeof query = query): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let stream: ReturnType<typeof query> | undefined;
  try {
    const prompt = [
      '你是经验沉淀器。阅读下面的会话记录（【用户】为请求与纠正，【助手】为回答摘要），把用户明确纠正、否定、偏好或确认的做法提炼为可复用的工程经验，并与已有经验合并。',
      '',
      '已有经验（合并去重：保留仍有效的条目；被新纠正推翻的条目删除或改写）：',
      input.existing.trim() || '（空）',
      '',
      '会话记录：',
      input.digest,
      '',
      '输出要求：',
      '1. 只输出 Markdown 正文：用「## 分类」组织（如 需求编写 / 排版与配图 / 工具与流程 / 沟通与输出），分类下用「- 」条目；没有内容的分类不要写。',
      '2. 每条经验一句话，写清「应当怎么做 / 不要怎么做」，必要时附简短原因；不整段摘抄会话。',
      '3. 只沉淀用户明确表达过的纠正或偏好，不编造用户没说过的事实、数字或结论。',
      '4. 没有新的可沉淀经验时：已有经验非空则原样输出已有经验；已有经验为空则只输出「（暂无沉淀经验）」。',
      '5. 总长度不超过 6000 字；不要输出代码块围栏、解释或标题以外的文字。',
    ].join('\n');
    stream = runtimeQuery({
      prompt,
      options: {
        cwd: ROOT,
        pathToClaudeCodeExecutable: CLAUDE,
        executable: 'node',
        // 必须加载用户级设置：认证方式和可用模型都在其中。
        settingSources: ['user'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        mcpServers: {},
        allowedTools: [],
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'NotebookEdit', 'BashOutput', 'KillShell'],
        includePartialMessages: false,
        abortController: controller,
        systemPrompt: {type: 'preset', preset: 'claude_code', append: '只做中文经验沉淀，只依据用户给出的会话记录与已有经验写作，不调用任何工具，不编造事实。'},
        ...(input.model ? {model: input.model} : {}),
      },
    });
    let text = '';
    for await (const message of stream) {
      if (message.type === 'assistant' && !message.parent_tool_use_id) {
        for (const block of message.message.content) if (block.type === 'text') text += block.text;
      }
      if (message.type === 'result') {
        if (message.subtype !== 'success') throw Error('EXPERIENCE_FAILED');
        if (typeof message.result === 'string' && message.result.trim()) text = message.result;
      }
    }
    const cleaned = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!cleaned) throw Error('EXPERIENCE_EMPTY');
    return cleaned.slice(0, 8000);
  } catch (error) {
    if (controller.signal.aborted) throw Error('EXPERIENCE_TIMEOUT');
    const message = error instanceof Error ? error.message : String(error);
    if (/^EXPERIENCE_[A-Z_]+$/.test(message)) throw error;
    throw Error('EXPERIENCE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    try { stream?.close(); } catch { /* 已结束 */ }
  }
}
