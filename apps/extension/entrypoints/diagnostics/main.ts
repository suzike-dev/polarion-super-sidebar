import { browser } from 'wxt/browser';
import { rpc } from '../../lib/client';
import './style.css';
const output = document.querySelector<HTMLPreElement>('#result')!;
async function check() {
  output.textContent = '连接中…';
  try { output.textContent = JSON.stringify({ extension: browser.runtime.getManifest().version, ...(await rpc({ method: 'health' })) }, null, 2); }
  catch (error) { output.textContent = String(error); }
}
document.querySelector('#check')!.addEventListener('click', () => void check());
document.querySelector('#reload')!.addEventListener('click', () => browser.runtime.reload());
void check();
