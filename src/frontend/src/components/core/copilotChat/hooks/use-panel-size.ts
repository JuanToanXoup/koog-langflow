import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const PANEL_SIZE_KEY = "langflow-assistant-panel-size";
const DEFAULT_SIZE = { width: 620, height: 600 };
export const MIN_PANEL_SIZE = { width: 456, height: 400 };
const MAX_SIZE = { width: 900, height: 800 };

type Size = { width: number; height: number };
type Edges = { x?: "left" | "right"; y?: "top" };

function readStoredSize(): Size {
  try {
    const stored = localStorage.getItem(PANEL_SIZE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.width && parsed.height) return parsed;
    }
  } catch {
    // localStorage may be unavailable (private browsing)
  }
  return DEFAULT_SIZE;
}

/**
 * Edge-drag resizing for the floating assistant panel, persisted under the same
 * key the previous panel used so a user's chosen size carries over.
 */
export function usePanelSize() {
  const [size, setSize] = useState<Size>(readStoredSize);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Drop document listeners if the panel unmounts mid-drag.
  useEffect(() => () => cleanupRef.current?.(), []);

  const startResize = useCallback(
    (e: ReactMouseEvent, edges: Edges) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const start = size;

      const handleMouseMove = (ev: MouseEvent) => {
        let width = start.width;
        let height = start.height;
        if (edges.x === "right") width = start.width + (ev.clientX - startX);
        if (edges.x === "left") width = start.width - (ev.clientX - startX);
        if (edges.y === "top") height = start.height - (ev.clientY - startY);
        setSize({
          width: Math.min(
            MAX_SIZE.width,
            Math.max(MIN_PANEL_SIZE.width, width),
          ),
          height: Math.min(
            MAX_SIZE.height,
            Math.max(MIN_PANEL_SIZE.height, height),
          ),
        });
      };

      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        cleanupRef.current = null;
      };

      const handleMouseUp = () => {
        cleanup();
        setSize((committed) => {
          try {
            localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(committed));
          } catch {
            // localStorage may be unavailable (private browsing)
          }
          return committed;
        });
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      cleanupRef.current = cleanup;
    },
    [size],
  );

  return { size, startResize };
}
