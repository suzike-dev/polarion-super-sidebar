// git push 直连 github.com 不稳定时：把「本地领先 origin/main 的提交」合成一次 API 提交推上去。
// 仅用于少量文件的补充提交；发布提交仍以正常 git 流程为准。
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = 'suzike-dev/polarion-super-sidebar';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const token = execFileSync('gh', ['auth', 'token'], {encoding: 'utf8'}).trim();
const api = async (route, init = {}) => {
  const response = await fetch('https://api.github.com' + route, {
    ...init,
    headers: {authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'psb-release', 'content-type': 'application/json', ...(init.headers ?? {})},
  });
  if (!response.ok) throw Error(`${route} ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
};

const ahead = git('log', '--format=%H', 'origin/main..HEAD').split('\n').filter(Boolean);
if (!ahead.length) { console.log('没有待推送提交'); process.exit(0); }
const message = git('log', '--format=%s', 'origin/main..HEAD').split('\n').filter(Boolean).join('\n\n');
const changed = git('diff', '--name-status', 'origin/main..HEAD').split('\n').filter(Boolean).map(line => {
  const [status, ...rest] = line.split('\t');
  return {status, file: rest.join('\t')};
});

const remoteHead = await api(`/repos/${repo}/git/ref/heads/main`);
const parentSha = remoteHead.object.sha;
const parent = await api(`/repos/${repo}/git/commits/${parentSha}`);
const tree = [];
for (const item of changed) {
  if (item.status === 'D') { tree.push({path: item.file, mode: '100644', type: 'blob', sha: null}); continue; }
  const content = fs.readFileSync(path.join(process.cwd(), item.file));
  const blob = await api(`/repos/${repo}/git/blobs`, {method: 'POST', body: JSON.stringify({content: content.toString('base64'), encoding: 'base64'})});
  tree.push({path: item.file, mode: '100644', type: 'blob', sha: blob.sha});
}
const newTree = await api(`/repos/${repo}/git/trees`, {method: 'POST', body: JSON.stringify({base_tree: parent.tree.sha, tree})});
const commit = await api(`/repos/${repo}/git/commits`, {method: 'POST', body: JSON.stringify({message, tree: newTree.sha, parents: [parentSha]})});
await api(`/repos/${repo}/git/refs/heads/main`, {method: 'PATCH', body: JSON.stringify({sha: commit.sha, force: false})});
console.log('已通过 API 推送:', commit.sha.slice(0, 7), `（${changed.length} 个文件，来源 ${ahead.length} 个本地提交）`);
