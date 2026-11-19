import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal, PanelRightClose, Search, Settings, type LucideIcon } from 'lucide-react';

type Tool = {
  label: string;
  title: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
};

type Props = {
  workItemId?: string;
  connected: boolean;
  primaryTools: Tool[];
  moreTools: Tool[];
  paletteOpen: boolean;
  onPalette: () => void;
  settingsOpen: boolean;
  settingsSaving: boolean;
  onSettings: (trigger: HTMLButtonElement) => void;
  onClose: () => void;
};

export function WorkspaceHeader({ workItemId, connected, primaryTools, moreTools, paletteOpen, onPalette, settingsOpen, settingsSaving, onSettings, onClose }: Props) {
  const header = useRef<HTMLElement>(null);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), toolList = useRef<HTMLDivElement>(null);
  const focusInlineTool = useRef(false);
  const toolsId = useId();
  const [compact, setCompact] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const connection = connected ? '本地 Host 已连接' : '本地 Host 未连接';

  useLayoutEffect(() => {
    const element = header.current!;
    const measure = () => {
      const narrow = element.getBoundingClientRect().width < 448;
      const focused = (element.getRootNode() as Document | ShadowRoot).activeElement;
      if (!narrow) {
        focusInlineTool.current = !!focused && focused === trigger.current;
        setExpanded(false);
      } else if (toolList.current?.contains(focused)) setExpanded(true);
      setCompact(narrow);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!compact && focusInlineTool.current) {
      toolList.current?.querySelector('button')?.focus({preventScroll: true});
      focusInlineTool.current = false;
    }
  }, [compact]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (disclosure.current && !event.composedPath().includes(disclosure.current)) setExpanded(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [expanded]);

  function toolButton({ label, title, icon: Icon, active, onSelect }: Tool, inDisclosure: boolean) {
    return <button key={label} type="button" className="icon header-tool" title={title} aria-label={title} aria-pressed={active} onClick={() => {
      if (inDisclosure) { trigger.current?.focus(); setExpanded(false); }
      onSelect();
    }}><Icon size={16} aria-hidden="true"/>{inDisclosure && <span>{label}</span>}</button>;
  }

  return <header ref={header} className={'assistant-header ' + (workItemId ? 'collaboration-bar' : 'brand')}>
    <div className="assistant-identity">
      <div className="assistant-logo">
        <span className="brand-mark" aria-hidden="true">P<span>+</span></span>
        <i className={'connection' + (connected ? ' online' : '')} role="img" title={connection} aria-label={connection}/>
      </div>
      <div className="assistant-wordmark"><strong>{workItemId ? 'AI 协作' : '工程助手'}</strong><small title={workItemId}>{workItemId || 'Polarion 工作区'}</small></div>
    </div>
    <div className="assistant-workbenches" role="group" aria-label="工作台">
      {primaryTools.map(tool => toolButton(tool, false))}
      <div ref={disclosure} className="assistant-more" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }} onKeyDown={event => {
        if (compact && expanded && event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); setExpanded(false); trigger.current?.focus();
        }
      }}>
        {compact && <button ref={trigger} type="button" className="icon assistant-more-trigger" title="更多工作台" aria-label="更多工作台" aria-expanded={expanded} aria-controls={toolsId} onClick={() => setExpanded(value => !value)}><MoreHorizontal size={17} aria-hidden="true"/></button>}
        <div ref={toolList} id={toolsId} className={'assistant-more-tools' + (compact ? ' as-popover' : '')} hidden={compact && !expanded} role="group" aria-label="更多工作台">
          {moreTools.map(tool => toolButton(tool, compact))}
        </div>
      </div>
    </div>
    <div className="assistant-header-controls" role="group" aria-label="助手操作">
      <button type="button" className="icon" title="命令面板（Ctrl+Shift+P）" aria-pressed={paletteOpen} onClick={onPalette}><Search size={16} aria-hidden="true"/></button>
      <button type="button" className="icon" title="设置" aria-expanded={settingsOpen} aria-disabled={settingsSaving || undefined} onClick={event => { if (!settingsSaving) onSettings(event.currentTarget); }}><Settings size={16} aria-hidden="true"/></button>
      <button type="button" className="icon" title={workItemId ? '收起编辑区 AI' : '收起助手，任务继续运行'} onClick={onClose}><PanelRightClose size={17} aria-hidden="true"/></button>
    </div>
  </header>;
}
