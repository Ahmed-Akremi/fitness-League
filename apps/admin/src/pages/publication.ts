/** Organizer space: drafts waiting for publication first (oldest request first), the rest in API order. */
export function waitingFirst<T extends { publicationRequestedAt?: string | null }>(list: T[]): T[] {
  const waiting = list.filter((c) => c.publicationRequestedAt).sort((a, b) => Date.parse(a.publicationRequestedAt!) - Date.parse(b.publicationRequestedAt!));
  return [...waiting, ...list.filter((c) => !c.publicationRequestedAt)];
}
