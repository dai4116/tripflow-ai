const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'

export const icons = {
  compass: {
    body: `<circle cx="12" cy="12" r="9" ${STROKE}/><path d="M15 9l-2 5-4 1 2-5z" fill="currentColor" stroke="none"/>`,
  },
  board: {
    body: `<rect x="4" y="4" width="7" height="16" rx="1.6" ${STROKE}/><rect x="14" y="4" width="7" height="10" rx="1.6" ${STROKE}/>`,
  },
  grid: {
    body: `<rect x="4" y="4" width="7" height="7" rx="1.6" ${STROKE}/><rect x="13" y="4" width="7" height="7" rx="1.6" ${STROKE}/><rect x="4" y="13" width="7" height="7" rx="1.6" ${STROKE}/><rect x="13" y="13" width="7" height="7" rx="1.6" ${STROKE}/>`,
  },
  plus: {
    body: `<path d="M12 5v14M5 12h14" ${STROKE} stroke-width="1.9"/>`,
  },
  pin: {
    body: `<path d="M12 21s-6.5-5.4-6.5-10.2A6.5 6.5 0 0 1 12 4.2a6.5 6.5 0 0 1 6.5 6.6C18.5 15.6 12 21 12 21z" ${STROKE}/><circle cx="12" cy="10.8" r="2.1" fill="currentColor" stroke="none"/>`,
  },
  'pin-solid': {
    tall: true,
    body: `<path d="M12 29C12 29 2 17.9 2 11a10 10 0 0 1 20 0c0 6.9-10 18-10 18z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="12" cy="11" r="3.4" fill="#fff" stroke="none"/>`,
  },
  calendar: {
    body: `<rect x="4" y="6" width="16" height="14" rx="2" ${STROKE}/><path d="M4 10h16M8 4v4M16 4v4" ${STROKE}/>`,
  },
  users: {
    body: `<circle cx="9" cy="9" r="3.2" ${STROKE}/><path d="M4 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5" ${STROKE}/><path d="M15.5 6.4a3.2 3.2 0 0 1 0 5.8M17.4 14.9c1.6.7 2.6 2 3 4.1" ${STROKE}/>`,
  },
  dollar: {
    body: `<path d="M12 3v18M16.2 7.5c-.7-1.3-2.2-2-4.1-2-2.3 0-3.9 1.2-3.9 3 0 4 8 2.4 8 6.6 0 1.9-1.7 3.2-4.1 3.2-2.1 0-3.7-.9-4.4-2.4" ${STROKE}/>`,
  },
  clock: {
    body: `<circle cx="12" cy="12" r="8.5" ${STROKE}/><path d="M12 7.5V12l3 2" ${STROKE}/>`,
  },
  star: {
    body: `<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.3 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z" fill="currentColor" stroke="none"/>`,
  },
  check: {
    body: `<path d="M5 12.5l4.5 4.5L19 7.5" ${STROKE} stroke-width="2"/>`,
  },
  close: {
    body: `<path d="M6 6l12 12M18 6L6 18" ${STROKE} stroke-width="1.9"/>`,
  },
  gear: {
    body: `<circle cx="12" cy="12" r="3" ${STROKE}/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18" ${STROKE}/>`,
  },
  sparkle: {
    body: `<path d="M12 3l1.9 5.6L20 10l-6.1 1.4L12 17l-1.9-5.6L4 10l6.1-1.4z" fill="currentColor" stroke="none"/><path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="currentColor" stroke="none"/>`,
  },
  search: {
    body: `<circle cx="11" cy="11" r="6.5" ${STROKE}/><path d="M16 16l4.5 4.5" ${STROKE}/>`,
  },
  filter: {
    body: `<path d="M4 6h16M7 12h10M10 18h4" ${STROKE}/>`,
  },
  mountain: {
    body: `<path d="M3 19L10 7l4 6.5L16.5 10 21 19z" ${STROKE}/>`,
  },
  coffee: {
    body: `<path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2.5 2.5 0 0 1 0 5h-2" ${STROKE}/>`,
  },
  museum: {
    body: `<path d="M4 9l8-5 8 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3.5 18.5h17" ${STROKE}/>`,
  },
  cutlery: {
    body: `<path d="M7 3v7M10 3v7M8.5 10v11M8.5 10c1.4 0 2-1 2-2.5V3M16.5 3c-1.7 1-2.5 3-2.5 5.5 0 2 .8 3 2.5 3V21" ${STROKE}/>`,
  },
  camera: {
    body: `<rect x="3.5" y="7" width="17" height="13" rx="2.5" ${STROKE}/><path d="M9 7l1.4-2.4h3.2L15 7" ${STROKE}/><circle cx="12" cy="13.3" r="3.4" ${STROKE}/>`,
  },
  leaf: {
    body: `<path d="M19 5c-9 0-14 4-14 10 0 2.5 1.5 4 4 4 6 0 10-5 10-14z" ${STROKE}/><path d="M5.5 18.5C9 14 13 11 17 8.5" ${STROKE}/>`,
  },
  bag: {
    body: `<path d="M6 8.5h12l-1 11H7z" ${STROKE}/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" ${STROKE}/>`,
  },
  train: {
    body: `<rect x="6" y="4" width="12" height="13" rx="3" ${STROKE}/><path d="M8.5 9h7M8.5 13h7M9 20l2-3M15 17l2 3" ${STROKE}/><circle cx="9.5" cy="15" r=".8" fill="currentColor" stroke="none"/><circle cx="14.5" cy="15" r=".8" fill="currentColor" stroke="none"/>`,
  },
  bed: {
    body: `<path d="M4 19V8M20 19v-5.5A3.5 3.5 0 0 0 16.5 10H10v9M4 14h16M6 10h4v4H6z" ${STROKE}/>`,
  },
  ticket: {
    body: `<path d="M5 7.5h14v3a2 2 0 0 0 0 3v3H5v-3a2 2 0 0 0 0-3z" ${STROKE}/><path d="M12 8.2v1.5M12 11.2v1.5M12 14.2v1.5" ${STROKE}/>`,
  },
  'arrow-right': {
    body: `<path d="M5 12h13M13 6.5L19 12l-6 5.5" ${STROKE} stroke-width="1.8"/>`,
  },
  'chevron-left': {
    body: `<path d="M14.5 5.5L8 12l6.5 6.5" ${STROKE} stroke-width="1.9"/>`,
  },
} satisfies Record<string, { body: string; tall?: boolean }>

export type IconName = keyof typeof icons
