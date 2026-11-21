import { useRef, useEffect, useLayoutEffect } from "react";
import { twMerge } from "tailwind-merge";
import { type Paths, setupSvgRenderer } from "@left4code/svg-renderer";

// Vendored from Cosmic UI (rizznme/cosmic-ui, src/components/ui/frame.tsx).

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const pathsCache = new Map<string, Paths>();

function parsePaths(json: string): Paths {
  const cached = pathsCache.get(json);
  if (cached) return cached;
  if (pathsCache.size > 200) pathsCache.clear();
  const parsed = JSON.parse(json) as Paths;
  pathsCache.set(json, parsed);
  return parsed;
}

type FrameSet = Record<string, Paths>;

const frameSetCache = new Map<string, FrameSet>();

function parseFrameSet(json: string): FrameSet {
  const cached = frameSetCache.get(json);
  if (cached) return cached;
  if (frameSetCache.size > 200) frameSetCache.clear();
  const parsed = JSON.parse(json) as FrameSet;
  frameSetCache.set(json, parsed);
  return parsed;
}

function Frame({
  className,
  paths,
  frames,
  frame,
  enableBackdropBlur,
  enableViewBox,
  ...props
}: {
  paths?: Paths;
  frames?: FrameSet;
  frame?: string;
  enableBackdropBlur?: boolean;
  enableViewBox?: boolean;
} & React.ComponentProps<"svg">) {
  const resolvedPaths = paths ?? (frames && frame ? frames[frame] : undefined);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (svgRef.current && svgRef.current.parentElement && resolvedPaths) {
      const instance = setupSvgRenderer({
        el: svgRef.current,
        paths: resolvedPaths,
        enableBackdropBlur,
        enableViewBox,
      });
      return () => instance.destroy();
    }
  }, [resolvedPaths, enableBackdropBlur, enableViewBox]);

  return (
    <svg
      {...props}
      className={twMerge(["absolute inset-0 size-full pointer-events-none", className])}
      xmlns="http://www.w3.org/2000/svg"
      ref={svgRef}
      suppressHydrationWarning
      data-frame-paths={JSON.stringify(resolvedPaths)}
      data-frame-backdrop-blur={enableBackdropBlur || undefined}
      data-frame-view-box={enableViewBox || undefined}
    />
  );
}

export { Frame, parsePaths, parseFrameSet };
export type { FrameSet };
