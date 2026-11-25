/** Server-safe className joiner (the @araf/ui cn lives in a client module). */
export function cn(...parts: Array<unknown>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
