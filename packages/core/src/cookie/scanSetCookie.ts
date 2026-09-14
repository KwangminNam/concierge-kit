import type { SetCookieInfo } from '../policy/types.js';

/** One `; key=value` segment, located by offset inside the original string. */
export interface CookieSegment {
  /** Attribute name, lowercased. For the leading pair this is the cookie name, lowercased. */
  readonly key: string;
  /** Index of the `;` that introduces this segment, or `-1` for the leading pair. */
  readonly sepStart: number;
  /** Index of the first non-space character of the segment. */
  readonly start: number;
  /** Index one past the last non-space character of the segment. */
  readonly end: number;
  /** Index of the first character of the value, when the segment has one. */
  readonly valueStart?: number;
  /** Index one past the last character of the value. */
  readonly valueEnd?: number;
}

/**
 * A `Set-Cookie` line indexed by offset rather than parsed into an object.
 *
 * Nothing here copies the cookie apart, which is the point: rewriting works by splicing the
 * original string, so attributes conciergekit has never heard of survive byte for byte.
 */
export interface ScannedSetCookie {
  readonly raw: string;
  readonly name: string;
  readonly nameStart: number;
  readonly nameEnd: number;
  /** Index of the first character of the cookie value. */
  readonly valueStart: number;
  /** Index one past the last character of the cookie value. */
  readonly valueEnd: number;
  readonly attributes: readonly CookieSegment[];
}

/**
 * Indexes a raw `Set-Cookie` line. Returns `null` when the line has no `name=value` pair,
 * which is the only shape conciergekit refuses to touch.
 *
 * @see https://conciergekit.dev/reference/cookie#scansetcookie
 */
export function scanSetCookie(raw: string): ScannedSetCookie | null {
  const segments = splitSegments(raw);
  const pair = segments[0];
  if (pair === undefined) return null;

  const eq = indexOfInRange(raw, '=', pair.start, pair.end);
  if (eq === -1) return null;

  const nameStart = pair.start;
  const nameEnd = trimEnd(raw, nameStart, eq);
  if (nameEnd <= nameStart) return null;

  const attributes: CookieSegment[] = [];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === undefined || seg.start >= seg.end) continue;
    attributes.push(toAttribute(raw, seg));
  }

  return {
    raw,
    name: raw.slice(nameStart, nameEnd),
    nameStart,
    nameEnd,
    valueStart: trimStart(raw, eq + 1, pair.end),
    valueEnd: pair.end,
    attributes,
  };
}

/**
 * Reads the attributes conciergekit reasons about into a value-free description.
 * Everything else is still listed by name in `attributes`.
 */
export function toSetCookieInfo(scanned: ScannedSetCookie): SetCookieInfo {
  const attributeNames: string[] = [];
  let domain: string | undefined;
  let path: string | undefined;
  let sameSite: 'strict' | 'lax' | 'none' | undefined;
  let secure = false;
  let httpOnly = false;

  for (const attr of scanned.attributes) {
    attributeNames.push(attr.key);
    switch (attr.key) {
      case 'domain':
        domain = valueOf(scanned.raw, attr);
        break;
      case 'path':
        path = valueOf(scanned.raw, attr);
        break;
      case 'secure':
        secure = true;
        break;
      case 'httponly':
        httpOnly = true;
        break;
      case 'samesite': {
        const value = valueOf(scanned.raw, attr)?.toLowerCase();
        if (value === 'strict' || value === 'lax' || value === 'none') sameSite = value;
        break;
      }
      default:
        break;
    }
  }

  return {
    name: scanned.name,
    ...(domain === undefined ? {} : { domain }),
    ...(path === undefined ? {} : { path }),
    ...(sameSite === undefined ? {} : { sameSite }),
    secure,
    httpOnly,
    attributes: attributeNames,
  };
}

export function findAttribute(scanned: ScannedSetCookie, key: string): CookieSegment | undefined {
  return scanned.attributes.find((attr) => attr.key === key);
}

export function valueOf(raw: string, segment: CookieSegment): string | undefined {
  if (segment.valueStart === undefined || segment.valueEnd === undefined) return undefined;
  return raw.slice(segment.valueStart, segment.valueEnd);
}

/**
 * Splits on `;` at the top level. A `;` inside a double-quoted value does not split,
 * which keeps quoted cookie values intact even though RFC 6265 does not allow one there.
 */
function splitSegments(raw: string): Array<{ sepStart: number; start: number; end: number }> {
  const out: Array<{ sepStart: number; start: number; end: number }> = [];
  let segStart = 0;
  let sepStart = -1;
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ';' && !inQuotes) {
      out.push(trimmed(raw, sepStart, segStart, i));
      sepStart = i;
      segStart = i + 1;
    }
  }
  out.push(trimmed(raw, sepStart, segStart, raw.length));
  return out;
}

function toAttribute(
  raw: string,
  seg: { sepStart: number; start: number; end: number },
): CookieSegment {
  const eq = indexOfInRange(raw, '=', seg.start, seg.end);
  if (eq === -1) {
    return { key: raw.slice(seg.start, seg.end).toLowerCase(), ...seg };
  }
  const key = raw.slice(seg.start, trimEnd(raw, seg.start, eq)).toLowerCase();
  const valueStart = trimStart(raw, eq + 1, seg.end);
  return { key, ...seg, valueStart, valueEnd: seg.end };
}

function trimmed(
  raw: string,
  sepStart: number,
  from: number,
  to: number,
): { sepStart: number; start: number; end: number } {
  return { sepStart, start: trimStart(raw, from, to), end: trimEnd(raw, from, to) };
}

function trimStart(raw: string, from: number, to: number): number {
  let i = from;
  while (i < to && isSpace(raw.charAt(i))) i++;
  return i;
}

function trimEnd(raw: string, from: number, to: number): number {
  let i = to;
  while (i > from && isSpace(raw.charAt(i - 1))) i--;
  return i;
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

function indexOfInRange(raw: string, needle: string, from: number, to: number): number {
  const found = raw.indexOf(needle, from);
  return found === -1 || found >= to ? -1 : found;
}
