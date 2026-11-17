// A section is one full screen in the vertical stack (Apps, Smart Home, ...).
// Up/Down switches sections; Left/Right moves between a section's focusable items.
export interface Section {
  /** Root element, 1920x1080, appended into the sections track. */
  readonly el: HTMLElement;
  /** Number of focusable items (0 = nothing focusable). */
  count(): number;
  /** Highlight item i (and scroll it into view if needed). */
  focus(i: number): void;
  /** Clear all focus visuals. */
  blur(): void;
  /** Activate item i (Enter / click). */
  activate(i: number): void;
  /** Optional: called when this section becomes the active one. */
  onEnter?(): void;
  /** Optional: the item focused when the screen is first shown (default 0). */
  readonly defaultItem?: number;
}
