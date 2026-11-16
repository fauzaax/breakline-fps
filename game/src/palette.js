// The look plan, in one place. Dusk at a decommissioned solar relay station: warm sandstone
// and rust under a cooling blue sky, amber for the Vanguard attackers, teal for the Sentinel
// defenders. The same hex values are the CSS custom properties in index.html.
export const PALETTE = {
  skyTop: '#2e3d5c',
  skyLow: '#e8955a',
  fog: '#c98a5e',
  ground: '#3a3128',
  sand: '#4a4234',
  wall: '#5c5142',
  darkWall: '#37302a',
  metal: '#6b6f75',
  rust: '#8a4a2b',
  panel: '#1f4e5f',
  panelEdge: '#2f7d94',
  hazard: '#e8c832',
  ink: '#efe8dc',
  muted: '#9a917f',
  amber: '#f2a33c',
  teal: '#2fd3c0',
  red: '#e5484d',
  charge: '#ff5a3c',
};

export function color(name) {
  return PALETTE[name];
}
