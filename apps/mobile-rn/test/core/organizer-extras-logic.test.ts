import { messageProblems, messageStatus, recipients } from '../../src/features/competitions/organizer/logic-messages';
import { availability, orderProblems, revenue, ticketCode } from '../../src/features/competitions/organizer/logic-shop';

const reg = (id: string, categoryId: string, name: string, paymentStatus = 'PAID', registrationStatus = 'CONFIRMED') => ({ id, categoryId, paymentStatus, registrationStatus, user: { profile: { fullName: name } } });
const data = {
  registrations: [reg('r1', 'k1', 'Sami'), reg('r2', 'k2', 'Amira', 'PENDING'), reg('r3', 'k1', 'Hédi'), reg('r5', 'k1', 'Omar', 'PENDING', 'CANCELLED')],
  checkins: [{ id: 'r1' }],
  waitingList: [{ id: 'wl1', name: 'Lina' }],
  staff: [{ id: 's1', user: { profile: { fullName: 'Judge Nour' } } }],
  applications: [{ id: 'a1', name: 'Volunteer Ali', status: 'APPROVED' }, { id: 'a2', name: 'Pending Rim', status: 'PENDING' }],
};

describe('messages', () => {
  it('finds the recipients of each segment (cancelled registrations left out)', () => {
    const names = (kind: string, categoryId?: string) => recipients({ kind: kind as never, categoryId }, data).map((r) => r.name);
    expect(names('ALL_ATHLETES')).toEqual(['Sami', 'Amira', 'Hédi']);
    expect(names('DIVISION', 'k1')).toEqual(['Sami', 'Hédi']);
    expect(names('UNPAID')).toEqual(['Amira']);
    expect(names('NOT_CHECKED_IN')).toEqual(['Amira', 'Hédi']);
    expect(names('WAITING_LIST')).toEqual(['Lina']);
    expect(names('STAFF')).toEqual(['Judge Nour']);
    expect(names('VOLUNTEERS')).toEqual(['Volunteer Ali']);
  });

  it('checks a message and tells scheduled from sent', () => {
    const now = Date.parse('2026-12-01T10:00:00Z');
    expect(messageProblems({ subject: '', body: ' ', sendAt: '2026-11-30T10:00:00Z' }, 0, now)).toEqual(['SUBJECT', 'BODY', 'NO_RECIPIENT', 'PAST']);
    expect(messageProblems({ subject: 'Heats', body: 'Out now', sendAt: null }, 3, now)).toEqual([]);
    expect(messageStatus({ sendAt: '2026-12-01T12:00:00Z', cancelled: false }, now)).toBe('SCHEDULED');
    expect(messageStatus({ sendAt: '2026-12-01T09:00:00Z', cancelled: false }, now)).toBe('SENT');
    expect(messageStatus({ sendAt: '2026-12-01T12:00:00Z', cancelled: true }, now)).toBe('CANCELLED');
  });
});

describe('tickets and shop', () => {
  const now = Date.parse('2026-12-01T10:00:00Z');
  const orders = [
    { id: 'o1', itemId: 't1', quantity: 3, status: 'PAID' },
    { id: 'o2', itemId: 't1', quantity: 2, status: 'RESERVED' },
    { id: 'o3', itemId: 't1', quantity: 4, status: 'CANCELLED' },
  ];

  it('counts what is sold and left, and closes sales after their end', () => {
    expect(availability({ id: 't1', limit: 10, salesEnd: null }, orders, now)).toEqual({ sold: 5, left: 5, onSale: true });
    expect(availability({ id: 't1', limit: 5, salesEnd: null }, orders, now)).toEqual({ sold: 5, left: 0, onSale: false });
    expect(availability({ id: 't1', limit: null, salesEnd: '2026-11-30T00:00:00Z' }, orders, now)).toEqual({ sold: 5, left: null, onSale: false });
  });

  it('refuses a bad quantity, more than is left, a closed sale and a missing size', () => {
    const item = { id: 't1', limit: 6, salesEnd: null, sizes: [] as string[] };
    expect(orderProblems(item, 0, orders, now)).toEqual(['QUANTITY']);
    expect(orderProblems(item, 2, orders, now)).toEqual(['SOLD_OUT']);
    expect(orderProblems(item, 1, orders, now)).toEqual([]);
    expect(orderProblems({ ...item, salesEnd: '2026-11-01T00:00:00Z' }, 1, orders, now)).toEqual(['CLOSED']);
    expect(orderProblems({ ...item, sizes: ['S', 'M'] }, 1, orders, now, null)).toEqual(['SIZE']);
  });

  it('adds up what is paid and makes readable ticket codes', () => {
    expect(revenue([{ id: 't1', price: 15000 }], orders)).toBe(45000);
    expect(ticketCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});
