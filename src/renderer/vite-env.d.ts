/// <reference types="vite/client" />

declare global {
  interface Window {
    aaa: any;
  }

  interface Node {
    contains(other: EventTarget | null): boolean;
  }
}

export {};
