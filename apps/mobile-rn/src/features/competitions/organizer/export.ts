import { Platform, Share } from 'react-native';

/** What the download needs from the page and from `URL` (passed in by the tests). */
export type CsvDoc = { createElement(tag: 'a'): { href: string; download: string; click(): void }; body: { appendChild(node: unknown): void; removeChild(node: unknown): void } };
export type CsvUrls = { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };

/** UTF-8 with a byte-order mark: spreadsheets then read the accents and the Arabic names. */
export const csvFileContent = (text: string) => `﻿${text}`;

/** On the web: the CSV is downloaded as a file. */
export function downloadCsv(fileName: string, text: string, doc: CsvDoc = document as unknown as CsvDoc, urls: CsvUrls = URL) {
  const url = urls.createObjectURL(new Blob([csvFileContent(text)], { type: 'text/csv;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // The browser has the file once the click returns; the address is freed a moment later.
  setTimeout(() => urls.revokeObjectURL(url), 1000);
}

/** One export for every organizer list: a file on the web, the share sheet on a phone (the app has no file library). */
export function exportCsv(fileName: string, text: string) {
  if (Platform.OS === 'web') downloadCsv(fileName, text);
  else void Share.share({ title: fileName, message: text });
}
