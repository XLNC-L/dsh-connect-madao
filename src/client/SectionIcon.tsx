import { jsx } from 'react/jsx-runtime'

/**
 * 设置页左侧导航那一格的图标。
 *
 * 宿主用 `{ size, active }` 渲染这一格，并自带按钮与文字，所以这里只画图形。
 *
 * 用「码」字本身当字形：16px 下任何抽象几何都会被读成别的字母（试过
 * 「方框 + 三横」的极简化，实际渲染出来像 OE），而汉字缩到这个尺寸仍然
 * 认得出来，也和面板顶部的 logo 保持一致。
 *
 * `active === false` 时压暗，与宿主其它未选中条目同一观感。
 */
export function SettingsSectionIcon(props: { size?: number; active?: boolean }) {
  const size = typeof props?.size === 'number' ? props.size : 16
  return jsx('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: Math.max(3, Math.round(size * 0.25)),
      background: 'linear-gradient(135deg,#c7000b,#ff6a00)',
      color: '#fff',
      fontSize: Math.max(9, Math.round(size * 0.68)),
      fontWeight: 700,
      lineHeight: 1,
      opacity: props?.active === false ? 0.55 : 1,
      flex: '0 0 auto',
    },
    children: '码',
  })
}
