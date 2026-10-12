import type { Word } from "./types";
// Only exact, unqualified requests use the local command. Requests with
// exceptions, negation, or a request for suggestions still go to the assistant.
export function isRemoveFillersCommand(command: string): boolean {
  return /^(?:please\s+)?(?:remove|delete|cut) (?:all (?:the )?|the )?filler words(?: from (?:this|the|my) transcript)?[.!]?$/i.test(command.trim());
}
export function removeDetectedFillers(words: Word[]): number {
  let count = 0;
  for (const word of words) if (word.filler && !word.deleted) { word.deleted = true; count++; }
  return count;
}
export function assistantResultError(event: Record<string, unknown>): string | null {
  if (event.type !== "result" || (!event.is_error && event.subtype === "success")) return null;
  return "The assistant could not finish this edit. Check your connection and assistant account in Settings. Any edits already saved will appear in the transcript.";
}
