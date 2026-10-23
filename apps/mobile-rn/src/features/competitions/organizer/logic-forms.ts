import type { Json } from '../../../core/api/client';

/**
 * Organisation update, phase 3: the questions athletes answer when they register, and the agreements they accept.
 * Kept on the device for now (the competition's `registrationForm` and `agreements`).
 */

export type FieldType = 'TEXT' | 'NUMBER' | 'SELECT' | 'SIZE' | 'DATE' | 'PHONE';
export type FormField = { id: string; label: string; type: FieldType; required: boolean; options: string[] };
export type FieldProblem = 'LABEL' | 'OPTIONS';

export const FIELD_TYPES: FieldType[] = ['TEXT', 'NUMBER', 'SELECT', 'SIZE', 'DATE', 'PHONE'];
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export type Agreements = {
  liability: { required: boolean; text: string };
  custom: { required: boolean; title: string; text: string };
  /** Athletes under `age` need a parent or guardian: their details, their signature, and the photo consent if asked. */
  minors: { enabled: boolean; age: number; photoConsent: boolean };
  medicalReport: { required: boolean; description: string };
  additionalDocument: { required: boolean; title: string; description: string };
  faceRecognition: { required: boolean };
};
export type AgreementProblem = 'LIABILITY_TEXT' | 'CUSTOM_TITLE' | 'CUSTOM_TEXT' | 'MINOR_AGE' | 'DOCUMENT_TITLE';

export function formOf(c: Json): FormField[] {
  return Array.isArray(c.registrationForm) ? c.registrationForm : [];
}

export function fieldProblems(f: FormField): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (!f.label.trim() || f.label.trim().length > 80) problems.push('LABEL');
  if (f.type === 'SELECT' && f.options.filter((o) => o.trim()).length < 2) problems.push('OPTIONS');
  return problems;
}

/** Swaps a field with its neighbour; out of range leaves the list as it is. */
export function moveField(fields: FormField[], index: number, dir: -1 | 1): FormField[] {
  const to = index + dir;
  if (to < 0 || to >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function agreementsOf(c: Json): Agreements {
  const a: Json = c.agreements ?? {};
  return {
    liability: { required: a.liability?.required === true, text: a.liability?.text ?? '' },
    custom: { required: a.custom?.required === true, title: a.custom?.title ?? '', text: a.custom?.text ?? '' },
    minors: { enabled: a.minors?.enabled === true, age: typeof a.minors?.age === 'number' ? a.minors.age : 18, photoConsent: a.minors?.photoConsent === true },
    medicalReport: { required: a.medicalReport?.required === true, description: a.medicalReport?.description ?? '' },
    additionalDocument: { required: a.additionalDocument?.required === true, title: a.additionalDocument?.title ?? '', description: a.additionalDocument?.description ?? '' },
    faceRecognition: { required: a.faceRecognition?.required === true },
  };
}

export function agreementProblems(a: Agreements): AgreementProblem[] {
  const problems: AgreementProblem[] = [];
  if (a.liability.required && !a.liability.text.trim()) problems.push('LIABILITY_TEXT');
  if (a.custom.required && !a.custom.title.trim()) problems.push('CUSTOM_TITLE');
  if (a.custom.required && !a.custom.text.trim()) problems.push('CUSTOM_TEXT');
  if (a.minors.enabled && !(Number.isInteger(a.minors.age) && a.minors.age >= 1 && a.minors.age <= 21)) problems.push('MINOR_AGE');
  if (a.additionalDocument.required && !a.additionalDocument.title.trim()) problems.push('DOCUMENT_TITLE');
  return problems;
}

const NUMBER = /^-?\d+([.,]\d+)?$/;
const PHONE = /^\+?[\d\s-]{6,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The ids of the fields an athlete must fix: a required one left empty, or an answer of the wrong kind. */
export function answerProblems(fields: FormField[], answers: Record<string, string>): string[] {
  return fields
    .filter((f) => {
      const v = (answers[f.id] ?? '').trim();
      if (!v) return f.required;
      if (f.type === 'NUMBER') return !NUMBER.test(v);
      if (f.type === 'PHONE') return !PHONE.test(v);
      if (f.type === 'DATE') return !DAY.test(v);
      if (f.type === 'SIZE') return !SIZES.includes(v);
      if (f.type === 'SELECT') return !f.options.includes(v);
      return false;
    })
    .map((f) => f.id);
}
