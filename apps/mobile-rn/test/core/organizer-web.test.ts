import { couponsCsv, csvFileName, csvSeparator, heatsCsv, leaderboardCsv, registrationsCsv, staffCsv } from '../../src/features/competitions/organizer/logic-b';
import { contentWidth, FORM_WIDTH, isWideWeb, menuMarks, ORG_MENU, WIDE_WIDTH } from '../../src/features/competitions/organizer/web';
import { event, regs } from '../organizer-fixtures';

describe('web layout rules', () => {
  it('the wide layout is for a browser window of 1024 px or more', () => {
    expect(isWideWeb('web', 1024)).toBe(true);
    expect(isWideWeb('web', 1023)).toBe(false);
    expect(isWideWeb('ios', 1366)).toBe(false);
    expect(isWideWeb('android', 1280)).toBe(false);
  });

  it('the menu holds every tab of the organizer space exactly once', () => {
    const tabs = ORG_MENU.flatMap((s) => s.tabs);
    expect([...tabs].sort()).toEqual(['announcements', 'categories', 'coupons', 'dashboard', 'finances', 'forms', 'general', 'leaderboard', 'live', 'participants', 'planning', 'pricing', 'race', 'roster', 'settings', 'staff', 'team', 'timetable', 'tools', 'waves', 'wods']);
  });

  it('forms stay narrow, figures and tables use the room', () => {
    expect(contentWidth('general')).toBe(FORM_WIDTH);
    expect(contentWidth('wods')).toBe(FORM_WIDTH);
    for (const tab of ['dashboard', 'participants', 'planning', 'leaderboard'] as const) expect(contentWidth(tab)).toBe(WIDE_WIDTH);
    expect(FORM_WIDTH - 32).toBe(720);
  });

  it('marks what the draft still misses and the number to collect', () => {
    const draft = { ...event, status: 'DRAFT', coverUrl: null, categories: [], workouts: [] };
    expect(menuMarks(draft, 2)).toEqual({ general: 'todo', categories: 'todo', wods: 'todo', participants: 2 });
    expect(menuMarks({ ...draft, publicationRequestedAt: '2026-10-15T08:00:00.000Z' }, 0)).toEqual({});
    expect(menuMarks(event, 0)).toEqual({});
  });
});

describe('exports', () => {
  it('a lane sheet: every lane of every heat, free lanes included', () => {
    const h = { name: 'RX Men · Heat 1', startsAt: '2026-12-12T10:00:00.000Z', laneCount: 3, workout: { name: 'WOD 1' }, category: { name: 'RX Men' }, lanes: [{ lane: 2, athlete: { fullName: 'Hédi Kéfi', username: 'hedi' } }] };
    expect(heatsCsv([h]).split('\n')).toEqual([
      'heat,starts_at,wod,category,lane,athlete,username',
      'RX Men · Heat 1,2026-12-12T10:00:00.000Z,WOD 1,RX Men,1,,',
      'RX Men · Heat 1,2026-12-12T10:00:00.000Z,WOD 1,RX Men,2,Hédi Kéfi,hedi',
      'RX Men · Heat 1,2026-12-12T10:00:00.000Z,WOD 1,RX Men,3,,',
    ]);
  });

  it('promo codes with their value in the event currency', () => {
    const list = [
      { code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: '2026-11-01T22:00:00.000Z', active: true },
      { code: 'TEN', type: 'FIXED_AMOUNT', value: 10000, categoryId: 'k2', maxUses: null, usedCount: 0, expiresAt: null, active: false },
      { code: 'GIFT', type: 'FREE', value: 0, categoryId: null, maxUses: 1, usedCount: 1, expiresAt: null, active: true },
    ];
    expect(couponsCsv(list, event.categories, 'TND').split('\n')).toEqual([
      'code,type,value,category,used,max_uses,expires_at,active',
      'EARLY,PERCENTAGE,20,,12,50,2026-11-01T22:00:00.000Z,yes',
      'TEN,FIXED_AMOUNT,10.000,RX Women,0,,,no',
      'GIFT,FREE,,,1,1,,yes',
    ]);
  });

  it('the team by role, and a leaderboard of one category', () => {
    const staff = [
      { role: 'JUDGE', user: { username: 'zed' } },
      { role: 'ORGANIZER', user: { username: 'a', profile: { fullName: 'Amel' } } },
    ];
    expect(staffCsv(staff).split('\n')).toEqual(['role,name,username', 'ORGANIZER,Amel,a', 'JUDGE,zed,zed']);
    const rows = [
      { rank: 1, athlete: { fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 },
      { rank: 2, athlete: { fullName: null, username: '=karim' }, totalPoints: 150, pending: 1 },
    ];
    expect(leaderboardCsv(rows, 'RX Men').split('\n')).toEqual(['category,rank,name,username,points,pending', 'RX Men,1,Hédi Kéfi,hedi,180,0', "RX Men,2,'=karim,'=karim,150,1"]);
  });

  it('file names carry the event address name', () => {
    expect(csvFileName({ slug: 'sousse-summer-2026' }, 'heats')).toBe('sousse-summer-2026-heats.csv');
    expect(csvFileName({}, 'team')).toBe('event-team.csv');
  });

  it('registrations still export as before', () => {
    expect(registrationsCsv([regs[0]]).split('\n')).toEqual([
      'name,username,category,registration,payment,amount,currency,registered_at',
      'Sami Ben Ali,sami_rx,RX Men,PENDING,PENDING,40.000,TND,2026-10-21T09:00:00.000Z',
    ]);
  });
});

describe('spreadsheets of every language', () => {
  it('French and Arabic spreadsheets split columns on « ; », English ones on « , »', () => {
    expect([csvSeparator('fr'), csvSeparator('ar'), csvSeparator('en')]).toEqual([';', ';', ',']);
    expect(registrationsCsv([regs[0]], ';').split('\n')).toEqual([
      'name;username;category;registration;payment;amount;currency;registered_at',
      'Sami Ben Ali;sami_rx;RX Men;PENDING;PENDING;40.000;TND;2026-10-21T09:00:00.000Z',
    ]);
    expect(staffCsv([{ role: 'ORGANIZER', user: { username: 'a', profile: { fullName: 'Ben Ali; Amel' } } }], ';').split('\n')[1]).toBe('ORGANIZER;"Ben Ali; Amel";a');
  });
});
