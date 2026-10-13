// Dots with a thin white rim and a light sphere-like shading (a soft shadow on the lower right), so that
// overlapping dots stay distinguishable. Helios draws the shading in 2D as well.
export const RIM_COLOR = [1, 1, 1, 0.9];

export function styleNodes(helios, { rim = 0.25 } = {}) {
  helios.nodeOutlineWidthBase(rim).nodeOutlineWidthScale(0);
  helios.nodeMapper.channel('outlineColor').constant(RIM_COLOR).done(); // the colour comes from the mapper, not from nodeOutlineColor()
  helios.shadedEnabled?.(true);
  helios.shadedNodes?.(true);
  helios.shadedLightDirection?.([-0.5, 0.6, 0.65]);
  helios.shadedDiffuseStrength?.(0.35);
  helios.shadedAmbientStrength?.(0.85);
  helios.shadedSpecularStrength?.(0.12);
  helios.shadedShininess?.(24);
}
