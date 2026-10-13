// Dots with a thin dark rim and a light sphere-like shading (a soft shadow on the lower right), so that
// overlapping dots stay distinguishable. Helios draws the shading in 2D as well.
export function styleNodes(helios, { rim = 0.5 } = {}) {
  helios.nodeOutlineWidthBase(rim).nodeOutlineWidthScale(0).nodeOutlineColor([0.02, 0.02, 0.03, 0.85]);
  helios.shadedEnabled?.(true);
  helios.shadedNodes?.(true);
  helios.shadedLightDirection?.([-0.5, 0.6, 0.65]);
  helios.shadedDiffuseStrength?.(0.35);
  helios.shadedAmbientStrength?.(0.85);
  helios.shadedSpecularStrength?.(0.12);
  helios.shadedShininess?.(24);
}
