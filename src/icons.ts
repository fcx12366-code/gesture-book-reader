const paths: Record<string, string> = {
 book: '<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1V5Z"/><path d="M12 6v15"/>',
 upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
 left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
 grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
 expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 hand: '<path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 5-3 7-7 7-3 0-5-2-6-4l-3-5a1.5 1.5 0 0 1 2-2l2 2Z"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
 lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
 file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8m-8 4h5"/>',
 minus: '<path d="M5 12h14"/>',
 chevron: '<path d="m6 9 6 6 6-6"/>',
 check: '<path d="m5 12 4 4L19 6"/>',
 camera: '<path d="M14 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm2 4 6-3v12l-6-3"/>',
 warning: '<path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v.1"/>',
 keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 12h.1M10 12h.1M14 12h.1M18 12h.1M7 16h10"/>',
 moon: '<path d="M20 15.6A8.8 8.8 0 0 1 8.4 4 9 9 0 1 0 20 15.6Z"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
 reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
};
export function icon(name: string, cls = ''): string {
 return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.book}</svg>`;
}
