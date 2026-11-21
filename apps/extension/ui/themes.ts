/** 界面主题目录：设置→外观 展示与预览用；令牌覆盖在 themes.css。 */
export type ThemeId = 'forest' | 'porcelain' | 'paper' | 'bamboo' | 'autumn' | 'sky' | 'tangerine' | 'rouge' | 'indigo' | 'lotus';
export const THEMES: { id: ThemeId; name: string; hint: string; group: 'base' | 'light' | 'traditional'; swatch: { surface: string; canvas: string; line: string; accent: string; accentSoft: string; ink: string } }[] = [
  { id: 'forest', name: '深林绿 · 默认', hint: '鼠尾草中性色 · 当前默认', group: 'base', swatch: { surface: '#ffffff', canvas: '#f0f3ea', line: '#e1e6d8', accent: '#1e573c', accentSoft: '#edf2e3', ink: '#242c24' } },
  { id: 'porcelain', name: '月白', hint: '白中泛青 · 轻盈素净', group: 'light', swatch: { surface: '#ffffff', canvas: '#eff1f0', line: '#e2e6e3', accent: '#1e573c', accentSoft: '#e9f0ec', ink: '#1f2622' } },
  { id: 'paper', name: '宣纸', hint: '米白纸感 · 温润不刺眼', group: 'light', swatch: { surface: '#fffdf8', canvas: '#f3efe2', line: '#e6e1d2', accent: '#34544a', accentSoft: '#e9edda', ink: '#2b2620' } },
  { id: 'bamboo', name: '竹青', hint: '中国传统色：浅翠竹色', group: 'light', swatch: { surface: '#fbfdf9', canvas: '#e6f2e4', line: '#d8e6d6', accent: '#23684a', accentSoft: '#e2f1e6', ink: '#1c2f22' } },
  { id: 'autumn', name: '秋香', hint: '中国传统色：浅黄微绿', group: 'light', swatch: { surface: '#fffef7', canvas: '#f4ecd2', line: '#e7dfc2', accent: '#8a5a1a', accentSoft: '#f5ecd7', ink: '#33290f' } },
  { id: 'sky', name: '天青', hint: '中国传统色：汝窑釉色青', group: 'light', swatch: { surface: '#fbfdfe', canvas: '#e3eef5', line: '#d3e2ec', accent: '#26698c', accentSoft: '#e3f0f6', ink: '#17262e' } },
  { id: 'tangerine', name: '缇色', hint: '中国传统色：浅橙（丹缇）', group: 'light', swatch: { surface: '#fffdf9', canvas: '#f6e8d6', line: '#ead9c4', accent: '#964d16', accentSoft: '#f7e9d9', ink: '#312415' } },
  { id: 'rouge', name: '胭脂', hint: '中国传统色：传统红', group: 'traditional', swatch: { surface: '#fffafa', canvas: '#f3e4e4', line: '#e7d4d4', accent: '#a03d48', accentSoft: '#f7e6e9', ink: '#2e1d20' } },
  { id: 'indigo', name: '黛青', hint: '中国传统色：墨蓝灰', group: 'traditional', swatch: { surface: '#f9fbfc', canvas: '#e4eaf0', line: '#d5dee6', accent: '#34526e', accentSoft: '#e5edf4', ink: '#1d2732' } },
  { id: 'lotus', name: '藕荷', hint: '中国传统色：浅紫荷色', group: 'traditional', swatch: { surface: '#fefbfd', canvas: '#efe4ee', line: '#e5d6e3', accent: '#7d4a78', accentSoft: '#f2e6f1', ink: '#291e2a' } },
];
