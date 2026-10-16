"use client";

import { useEffect } from "react";

// What every overlay needs: focus moves to the heading on open, Escape closes, Tab stays inside,
// the page behind does not scroll, and focus goes back to the opener on close.
export function useDialog({ open, onClose, panelRef, headingRef, returnFocusTo }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    headingRef.current?.focus();
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      const target = (returnFocusTo && document.getElementById(returnFocusTo)) ?? previous;
      target?.focus?.();
    };
  }, [open, onClose, panelRef, headingRef, returnFocusTo]);
}
