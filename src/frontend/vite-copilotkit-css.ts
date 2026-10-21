import postcssCascadeLayers from "@csstools/postcss-cascade-layers";
import postcss from "postcss";
import type { Plugin } from "vite";

// CopilotKit ships a prebuilt Tailwind v4 stylesheet. Two things go wrong when
// it meets Langflow's Tailwind 3 pipeline:
//  - Tailwind 3's PostCSS plugin rejects its `@layer base { ... }` blocks
//    ("`@layer base` is used but no matching `@tailwind base` directive").
//  - Its rules live in cascade layers, and any unlayered rule beats any layered
//    one. Langflow's compiled preflight is unlayered, so `button { background:
//    transparent }` would override CopilotKit's `cpk:bg-*` utilities.
// Flattening the layers into specificity (the cascade-layers polyfill) fixes
// both: the order between CopilotKit's own layers is kept, and its utilities
// outrank element-level resets.
const COPILOTKIT_CSS =
  /@copilotkit[\\/]react-core[\\/]dist[\\/]v2[\\/]index\.css$/;

export function copilotkitCss(): Plugin {
  const processor = postcss([postcssCascadeLayers()]);
  return {
    name: "langflow-copilotkit-css",
    enforce: "pre",
    async transform(code, id) {
      if (!COPILOTKIT_CSS.test(id.split("?")[0])) return null;
      const result = await processor.process(code, { from: id });
      return { code: result.css, map: null };
    },
  };
}
