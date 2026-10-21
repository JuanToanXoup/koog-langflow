import postcss, {
  type AtRule,
  type PluginCreator,
  type Root,
  type Rule,
} from "postcss";
import selectorParser from "postcss-selector-parser";
import type { Plugin } from "vite";

// CopilotKit ships a prebuilt Tailwind v4 stylesheet whose rules live in cascade
// layers (theme, base, components, utilities). Two things go wrong when it
// meets Langflow's Tailwind 3 pipeline:
//  - Tailwind 3's PostCSS plugin rejects its `@layer base { ... }` blocks
//    ("`@layer base` is used but no matching `@tailwind base` directive").
//  - Any unlayered rule beats any layered one. Langflow's compiled CSS is
//    unlayered, so its preflight (`button { background: transparent }`,
//    `ol { list-style: none }`) would override CopilotKit's utilities.
// So the layers are removed, and specificity reproduces the order they gave:
//  - base (CopilotKit's own preflight, scoped to [data-copilotkit]) drops to
//    zero specificity, below everything. Langflow's preflight is nearly the
//    same reset, and Langflow components rendered inside the chat (the
//    assistant's review cards) keep their utility classes.
//  - components (chat markdown styling) sits just above element resets
//    (0,0,2) and below any class, so CopilotKit's utilities still win over it.
//  - utilities keep their own class specificity, which beats element-level
//    resets.
const COPILOTKIT_CSS =
  /@copilotkit[\\/]react-core[\\/]dist[\\/]v2[\\/]index\.css$/;

const LEGACY_PSEUDO_ELEMENTS = new Set([
  ":before",
  ":after",
  ":first-line",
  ":first-letter",
]);

function isPseudoElement(node: selectorParser.Node): boolean {
  return (
    node.type === "pseudo" &&
    (node.value.startsWith("::") || LEGACY_PSEUDO_ELEMENTS.has(node.value))
  );
}

/**
 * Wrap a selector in `:where()` (plus `boost`), keeping a trailing
 * pseudo-element outside: `:where()` cannot contain one.
 */
export function lowerSpecificity(selector: string, boost = ""): string {
  let result = selector;
  selectorParser((root) => {
    root.each((complex) => {
      const nodes = complex.nodes;
      const pseudoIndex = nodes.findIndex(isPseudoElement);
      const head = (pseudoIndex === -1 ? nodes : nodes.slice(0, pseudoIndex))
        .map(String)
        .join("");
      const tail =
        pseudoIndex === -1 ? "" : nodes.slice(pseudoIndex).map(String).join("");
      // `[data-copilotkit] ::placeholder` → the element part is "any descendant".
      const subject =
        head.trim() === "" || /[\s>+~]$/.test(head) ? `${head.trimEnd()} *` : head;
      result = `:where(${subject.trim()})${boost}${tail}`;
    });
  }).processSync(selector);
  return result;
}

const BOOSTS: Record<string, string | undefined> = {
  base: "",
  // Two never-matching type selectors in :not() add (0,0,2) and nothing else.
  components: ":not(cpk-a):not(cpk-b)",
};

/**
 * CopilotKit defines shadcn-style theme variables (`--background`, `--muted`,
 * `--border`, ...) on `[data-copilotkit]` as full oklch colors. Langflow uses
 * the same names for HSL components (`hsl(var(--muted))`), so inside the chat
 * every Langflow class that reads one resolves to an invalid color. CopilotKit's
 * copies move to a `--cpk-theme-` prefix; its own rules follow them.
 */
function renameThemeVariables(root: Root): void {
  const names = new Set<string>();
  root.walkDecls((decl) => {
    const rule = decl.parent as Rule | undefined;
    if (
      decl.prop.startsWith("--") &&
      !decl.prop.startsWith("--cpk-") &&
      !decl.prop.startsWith("--tw-") &&
      // Read by CopilotKit's own inline styles, so the name must not change.
      !decl.prop.startsWith("--copilot") &&
      rule?.type === "rule" &&
      rule.selector.includes("data-copilotkit")
    ) {
      names.add(decl.prop.slice(2));
    }
  });
  if (names.size === 0) return;
  const alternatives = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const usage = new RegExp(`var\\(\\s*--(${alternatives})(?![\\w-])`, "g");
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--") && names.has(decl.prop.slice(2))) {
      decl.prop = `--cpk-theme-${decl.prop.slice(2)}`;
    }
    if (decl.value.includes("var(")) {
      decl.value = decl.value.replace(usage, "var(--cpk-theme-$1");
    }
  });
}

export const flattenCopilotKitLayers: PluginCreator<void> = () => ({
  postcssPlugin: "langflow-flatten-copilotkit-layers",
  Once(root) {
    renameThemeVariables(root);
    root.walkAtRules("layer", (layer: AtRule) => {
      if (!layer.nodes) {
        // `@layer a, b;` only declares the order.
        layer.remove();
        return;
      }
      const boost = BOOSTS[layer.params.trim()];
      if (boost !== undefined) {
        layer.walkRules((rule: Rule) => {
          const parent = rule.parent as AtRule | undefined;
          if (parent?.type === "atrule" && /keyframes$/i.test(parent.name)) {
            return;
          }
          rule.selectors = rule.selectors.map((s) => lowerSpecificity(s, boost));
        });
      }
      layer.replaceWith(layer.nodes);
    });
  },
});
flattenCopilotKitLayers.postcss = true;

export function copilotkitCss(): Plugin {
  const processor = postcss([flattenCopilotKitLayers()]);
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
