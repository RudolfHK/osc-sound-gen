export const TAB_COLORS = [
  '#00ff88', '#ffb000', '#00aaff', '#ff4466',
  '#cc44ff', '#ff8800', '#44ffcc', '#ff66aa',
] as const;

export function getTabColor(index: number): string {
  return TAB_COLORS[index % TAB_COLORS.length];
}
