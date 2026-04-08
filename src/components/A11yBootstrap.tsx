"use client";

import { useEffect } from "react";

function applyPrefs() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const contrast = (() => {
    try {
      return localStorage.getItem("saneplus.a11y.contrast") ?? "";
    } catch {
      return "";
    }
  })();
  const simplicity = (() => {
    try {
      return localStorage.getItem("saneplus.a11y.simplicity") ?? "";
    } catch {
      return "";
    }
  })();

  if (contrast === "high") root.dataset.a11yContrast = "high";
  else delete root.dataset.a11yContrast;

  if (simplicity === "on") root.dataset.a11ySimplicity = "on";
  else delete root.dataset.a11ySimplicity;
}

export function A11yBootstrap() {
  useEffect(() => {
    applyPrefs();
    function onStorage(e: StorageEvent) {
      if (!e.key) return;
      if (e.key === "saneplus.a11y.contrast" || e.key === "saneplus.a11y.simplicity") {
        applyPrefs();
      }
    }
    function onCustom() {
      applyPrefs();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("saneplus:a11y", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("saneplus:a11y", onCustom as EventListener);
    };
  }, []);
  return null;
}

