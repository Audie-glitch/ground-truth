"use client";

import { useSyncExternalStore } from "react";

import {
  emptyAccount,
  loadAccount,
  PAPER_STORAGE_KEY,
  saveAccount,
} from "./paper";
import type { PaperAccount } from "./types";

/**
 * The paper account lives in localStorage, which the server cannot see. Reading
 * it through an external store lets the server render a known-empty account and
 * lets the client swap in the stored one after hydration, without a mismatch
 * and without writing state from an effect.
 */
const SERVER_SNAPSHOT: PaperAccount = emptyAccount();

let snapshot: PaperAccount | null = null;
let boundToWindow = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function getSnapshot(): PaperAccount {
  if (snapshot === null) snapshot = loadAccount();
  return snapshot;
}

function getServerSnapshot(): PaperAccount {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Keep sibling tabs in sync so the same account cannot silently fork.
  if (!boundToWindow && typeof window !== "undefined") {
    boundToWindow = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== PAPER_STORAGE_KEY) return;
      snapshot = loadAccount();
      notify();
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

export function updatePaperAccount(next: PaperAccount): void {
  snapshot = next;
  saveAccount(next);
  notify();
}

export function usePaperAccount(): PaperAccount {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
