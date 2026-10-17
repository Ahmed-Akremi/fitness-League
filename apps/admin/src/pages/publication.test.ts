import { waitingFirst } from './publication';

it('puts drafts waiting for publication first, oldest request first, then the rest in API order', () => {
  const list = [
    { id: 'a', publicationRequestedAt: null },
    { id: 'b', publicationRequestedAt: '2026-10-14T10:00:00.000Z' },
    { id: 'c', publicationRequestedAt: '2026-10-13T10:00:00.000Z' },
    { id: 'd' },
  ];
  expect(waitingFirst(list).map((c) => c.id)).toEqual(['c', 'b', 'a', 'd']);
});
