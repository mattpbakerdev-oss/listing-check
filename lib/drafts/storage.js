// localStorage access for draft autosave. Every call is wrapped: a private window, a full
// quota or a browser with storage switched off must not break the page.
import { STORAGE_KEY, serialize, parse } from "./autosave.js";

export function readDraft() {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeDraft(draft, at = Date.now()) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serialize(draft, at));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
