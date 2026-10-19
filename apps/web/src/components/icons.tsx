import type { SVGProps } from "react";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function Cube(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" {...base} strokeWidth={3.5} aria-hidden="true" {...props}>
      <path d="M32 10 53 22v20L32 54 11 42V22z" />
      <path d="M11 22 32 34l21-12M32 34v20" />
    </svg>
  );
}

export function Desk(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 40" {...base} aria-hidden="true" {...props}>
      <rect x="13" y="5" width="22" height="15" rx="2" />
      <path d="M24 20v5M19 25h10M5 32h38M9 32v6M39 32v6" />
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...base} aria-hidden="true" {...props}>
      <path d="M4 11 12 4l8 7v9H4zM10 20v-5h4v5" />
    </svg>
  );
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...base} aria-hidden="true" {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c1.9.7 3 2.4 3 5.2" />
    </svg>
  );
}

export function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...base} aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  );
}

export function ListIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...base} aria-hidden="true" {...props}>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

export function OfficeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...base} aria-hidden="true" {...props}>
      <path d="M5 21V4h9v17M14 9h5v12M3 21h18M8.5 8h2M8.5 12h2M8.5 16h2" />
    </svg>
  );
}
