import { config } from './config';

/** An email to the team whose subject says who is writing. */
export function mailto(subject: string, email: string = config.contactEmail): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

/** A wa.me link with a pre-filled message, or null while no number is configured. */
export function whatsappLink(text: string, number: string = config.whatsapp): string | null {
  const digits = number.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
