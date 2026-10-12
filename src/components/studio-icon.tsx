import type { CSSProperties } from "react";

export type IconName = "chevron" | "plus" | "search" | "arrow" | "back" | "film" | "wave" | "text" | "cut" | "play" | "pause" | "undo" | "redo" | "download" | "check" | "spark" | "eye" | "close" | "folder" | "settings" | "key" | "volume" | "muted" | "fullscreen";
const paths: Record<IconName, string> = {
  volume: "M11 4L6 8H2v8h4l5 4V4M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14",
  muted: "M11 4L6 8H2v8h4l5 4V4M16 9l6 6M22 9l-6 6",
  fullscreen: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5",
  settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  key: "M14 5a5 5 0 1 1-3 9l-7 7H1v-3l7-7a5 5 0 0 1 6-6M16 8h.01",
  chevron: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  film: "M4 3h16v18H4zM4 8h16M4 16h16M8 3v5M16 3v5M8 16v5M16 16v5",
  wave: "M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4",
  text: "M4 5h16M12 5v15M8 20h8",
  cut: "M9 8l11 12M9 16L20 4M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  play: "M8 4l12 8-12 8z",
  pause: "M8 4v16M16 4v16",
  undo: "M8 4L3 9l5 5M3 9h11a7 7 0 0 1 0 14",
  redo: "M16 4l5 5-5 5M21 9H10a7 7 0 0 0 0 14",
  download: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
  check: "M5 12l4 4L19 6",
  spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  close: "M6 6l12 12M6 18L18 6",
  folder: "M3 7V4h6l3 3h9v13H3z",
};
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
export function StudioMark() {
  return <svg className="studio-mark" viewBox="3 0 64 64" fill="none" aria-hidden="true">
    <path fill="currentColor" d="M14 10h16c14.36 0 24 8.63 25.73 20.1L42.7 35.05c.2-.97.3-1.98.3-3.05 0-7.73-5.27-13-13-13h-5v22.76L14 45.93V10Z" />
    <path fill="currentColor" d="m14 51.28 41.9-15.9C54.3 47 44.1 54 30 54H14v-2.72Z" />
  </svg>;
}
