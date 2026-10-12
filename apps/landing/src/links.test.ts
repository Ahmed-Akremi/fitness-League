import { mailto, whatsappLink } from './links';

describe('mailto', () => {
  it('writes to the contact address with an encoded subject', () => {
    expect(mailto('Gym – register')).toBe('mailto:ahmedakremi42@gmail.com?subject=Gym%20%E2%80%93%20register');
  });

  it('escapes the characters that would end the subject', () => {
    expect(mailto('Q&A? #1', 'team@example.com')).toBe('mailto:team@example.com?subject=Q%26A%3F%20%231');
  });

  it('keeps an Arabic subject intact once decoded', () => {
    const subject = 'صالة – التسجيل';
    expect(decodeURIComponent(mailto(subject, 'a@b.c').split('subject=')[1])).toBe(subject);
  });
});

describe('whatsappLink', () => {
  it('is null while no number is configured', () => {
    expect(whatsappLink('Hi', '')).toBeNull();
    expect(whatsappLink('Hi', ' + - ')).toBeNull();
  });

  it('keeps the digits of the number and encodes the message', () => {
    expect(whatsappLink('Hello Fitness League!', '+216 20-123 456')).toBe('https://wa.me/21620123456?text=Hello%20Fitness%20League!');
  });
});
