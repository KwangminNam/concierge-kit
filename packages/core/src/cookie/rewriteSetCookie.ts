import { domainMatches, isLoopbackHost, type RelayContext } from '../context.js';
import { devWarnOnce } from '../internal/dev.js';
import type { ResolvedCookieRules } from '../policy/defaults.js';
import type { SetCookieInfo } from '../policy/types.js';
import { findAttribute, type ScannedSetCookie } from './scanSetCookie.js';

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

type DomainAction = { kind: 'keep' } | { kind: 'strip' } | { kind: 'set'; value: string };
type SecureAction = 'keep' | 'strip' | 'add';
type ValueAction = { kind: 'keep' } | { kind: 'set'; value: string };

/**
 * Produces the `Set-Cookie` line to send to the browser by splicing the upstream one.
 *
 * The only attributes ever touched are `Domain`, `Secure`, `SameSite` and `Path`, plus the
 * cookie name when a rename is configured. Everything else, including attributes that did
 * not exist when this was written, passes through untouched because the code never takes
 * the cookie apart.
 *
 * @see https://concierge-kit.dev/reference/cookie#rewritesetcookie
 */
export function rewriteSetCookie(
  scanned: ScannedSetCookie,
  info: SetCookieInfo,
  rules: ResolvedCookieRules,
  ctx?: RelayContext,
): string {
  const raw = scanned.raw;
  const edits: Edit[] = [];
  const appends: string[] = [];

  const renamed = rules.renameToBrowser?.(info.name);
  if (renamed !== undefined && renamed !== '' && renamed !== info.name) {
    edits.push({ start: scanned.nameStart, end: scanned.nameEnd, text: renamed });
  }

  const secure = resolveSecure(rules.secure, info, ctx);
  const finalSecure = secure === 'add' ? true : secure === 'strip' ? false : info.secure;

  applyDomain(scanned, resolveDomain(rules.domain, info, ctx), edits, appends);
  applyFlag(scanned, 'secure', secure, 'Secure', edits, appends);
  // Partitioned requires Secure. Leaving it behind would make the browser reject the cookie.
  if (secure === 'strip') applyFlag(scanned, 'partitioned', 'strip', 'Partitioned', edits, appends);
  applyValue(
    scanned,
    'samesite',
    resolveSameSite(rules.sameSite, info, finalSecure),
    'SameSite',
    edits,
    appends,
  );
  applyValue(scanned, 'path', resolvePath(rules.path, info), 'Path', edits, appends);

  let out = raw;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  if (appends.length > 0) {
    out = `${out.replace(/[;\s]+$/, '')}; ${appends.join('; ')}`;
  }
  return out;
}

function resolveDomain(
  rule: ResolvedCookieRules['domain'],
  info: SetCookieInfo,
  ctx?: RelayContext,
): DomainAction {
  if (typeof rule === 'function') {
    const next = rule(info.domain);
    if (next === undefined) return { kind: 'keep' };
    if (next === null) return info.domain === undefined ? { kind: 'keep' } : { kind: 'strip' };
    return { kind: 'set', value: next };
  }
  switch (rule) {
    case 'strip':
      return info.domain === undefined ? { kind: 'keep' } : { kind: 'strip' };
    case 'auto':
      if (info.domain === undefined || ctx === undefined) return { kind: 'keep' };
      return domainMatches(ctx.host, info.domain) ? { kind: 'keep' } : { kind: 'strip' };
    case 'keep':
    default:
      return { kind: 'keep' };
  }
}

function resolveSecure(
  rule: ResolvedCookieRules['secure'],
  info: SetCookieInfo,
  ctx?: RelayContext,
): SecureAction {
  switch (rule) {
    case 'strip':
      return info.secure ? 'strip' : 'keep';
    case 'force':
      return info.secure ? 'keep' : 'add';
    case 'auto': {
      if (ctx === undefined || ctx.proto === 'https' || !info.secure) return 'keep';
      // Browsers grant loopback hosts a secure context, so the cookie is stored as it is.
      if (isLoopbackHost(ctx.host)) return 'keep';
      if (hasSecurePrefix(info.name)) {
        devWarnOnce(
          undefined,
          `secure-prefix:${info.name}`,
          `cookie "${info.name}" carries a __Host- or __Secure- prefix, which requires Secure. ` +
            'It cannot be stored over plain http on a host that is not localhost, so it was left ' +
            'untouched rather than made invalid.',
        );
        return 'keep';
      }
      return 'strip';
    }
    case 'keep':
    default:
      return 'keep';
  }
}

function hasSecurePrefix(name: string): boolean {
  return name.startsWith('__Host-') || name.startsWith('__Secure-');
}

function resolveSameSite(
  rule: ResolvedCookieRules['sameSite'],
  info: SetCookieInfo,
  finalSecure: boolean,
): ValueAction {
  if (rule === 'auto') {
    return info.sameSite === 'none' && !finalSecure
      ? { kind: 'set', value: 'Lax' }
      : { kind: 'keep' };
  }
  if (rule === 'keep') return { kind: 'keep' };
  const value = rule === 'lax' ? 'Lax' : rule === 'strict' ? 'Strict' : 'None';
  return info.sameSite === rule ? { kind: 'keep' } : { kind: 'set', value };
}

function resolvePath(rule: ResolvedCookieRules['path'], info: SetCookieInfo): ValueAction {
  if (rule === 'keep') return { kind: 'keep' };
  return info.path === rule ? { kind: 'keep' } : { kind: 'set', value: rule };
}

function applyDomain(
  scanned: ScannedSetCookie,
  action: DomainAction,
  edits: Edit[],
  appends: string[],
): void {
  if (action.kind === 'keep') return;
  const attr = findAttribute(scanned, 'domain');
  if (action.kind === 'strip') {
    if (attr !== undefined) edits.push({ start: attr.sepStart, end: attr.end, text: '' });
    return;
  }
  if (attr === undefined) {
    appends.push(`Domain=${action.value}`);
  } else {
    edits.push({ start: attr.start, end: attr.end, text: `Domain=${action.value}` });
  }
}

function applyFlag(
  scanned: ScannedSetCookie,
  key: string,
  action: SecureAction,
  label: string,
  edits: Edit[],
  appends: string[],
): void {
  if (action === 'keep') return;
  const attr = findAttribute(scanned, key);
  if (action === 'strip') {
    if (attr !== undefined) edits.push({ start: attr.sepStart, end: attr.end, text: '' });
    return;
  }
  if (attr === undefined) appends.push(label);
}

function applyValue(
  scanned: ScannedSetCookie,
  key: string,
  action: ValueAction,
  label: string,
  edits: Edit[],
  appends: string[],
): void {
  if (action.kind === 'keep') return;
  const attr = findAttribute(scanned, key);
  if (attr === undefined) {
    appends.push(`${label}=${action.value}`);
  } else {
    edits.push({ start: attr.start, end: attr.end, text: `${label}=${action.value}` });
  }
}
