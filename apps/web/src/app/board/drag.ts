import type { TaskState } from "@voicemural/workspace";

/**
 * What a dragged card carries, and the guard that reads it back.
 *
 * Its own module so the card and the board can share it without importing each
 * other — the board renders the card, so the card must not import the board.
 *
 * Pragmatic drag-and-drop types payloads as `Record<string, unknown>`, on the
 * grounds that anything on the page may start a drag and a monitor has no way
 * to know what it is looking at. `isDragData` is where that becomes typed
 * again, and it is why a stray draggable elsewhere on the page cannot be
 * mistaken for a card and moved.
 */
export interface DragData extends Record<string, unknown> {
  /** Root of the revision chain — the card's stable identity. */
  cardId: string;
  /** The head block the move must be aimed at. */
  blockId: string;
  /** Where it started, so a drop back onto the same column can be ignored. */
  from: TaskState;
}

export function isDragData(data: Record<string, unknown>): data is DragData {
  return typeof data.cardId === "string" && typeof data.blockId === "string";
}
