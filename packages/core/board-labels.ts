/**
 * Mermaid 转换器把形状文字放在容器的 `label` 字段里；Excalidraw 0.18 的
 * restoreElements 不负责把它变成可编辑的绑定文字，直接入画会得到一排空白形状。
 * 这里把 label 展开成真正的 text 图元：容器文字绑定到容器，连线标签放在中点。
 */
type Label = {text?: string; fontSize?: number; textAlign?: string; color?: string};
type DiagramElement = {
  id: string; type: string; x: number; y: number; width: number; height: number;
  label?: Label; boundElements?: {id: string; type: string}[] | null; groupIds?: string[];
};

const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function bindDiagramLabels<T extends DiagramElement>(source: readonly T[]): T[] {
  const output: T[] = [];
  for (const element of source) {
    const label = element.label;
    const text = (label?.text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!label || !text) { output.push(element); continue; }
    const left = finite(element.x), top = finite(element.y);
    const boxWidth = Math.abs(finite(element.width)), boxHeight = Math.abs(finite(element.height));
    const fontSize = Math.max(10, Math.min(48, finite(label.fontSize, 16) || 16));
    const lines = text.split('\n');
    const measured = Math.max(...lines.map(line => [...line].reduce((width, char) => width + (char.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.6), 0)));
    const width = Math.max(24, Math.min(Math.max(24, boxWidth - 12), measured));
    const height = Math.max(fontSize * 1.25, lines.length * fontSize * 1.25);
    const bound = element.type === 'arrow' || element.type === 'line' ? null : element.id;
    const textElement = {
      id: element.id + '-label',
      type: 'text',
      x: left + (boxWidth - width) / 2,
      y: top + (boxHeight - height) / 2,
      width,
      height,
      angle: 0,
      strokeColor: label.color ?? '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: element.groupIds ?? [],
      frameId: null,
      index: null,
      roundness: null,
      seed: Math.floor(Math.random() * 2147483646) + 1,
      version: 1,
      versionNonce: Math.floor(Math.random() * 2147483646) + 1,
      isDeleted: false,
      boundElements: [],
      updated: Date.now(),
      link: null,
      locked: false,
      text,
      originalText: text,
      fontSize,
      fontFamily: 2,
      textAlign: label.textAlign ?? 'center',
      verticalAlign: 'middle',
      containerId: bound,
      autoResize: false,
      lineHeight: 1.25,
    };
    const {label: _containerLabel, ...container} = element as T & {label?: Label};
    if (bound) container.boundElements = [...(element.boundElements ?? []).filter(item => item.id !== textElement.id), {id: textElement.id, type: 'text'}];
    output.push(container as T, textElement as unknown as T);
  }
  return output;
}
