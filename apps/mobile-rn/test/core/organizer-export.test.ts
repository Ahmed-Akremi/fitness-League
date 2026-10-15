import { Share } from 'react-native';

import { csvFileContent, downloadCsv, exportCsv, shareOrCopy } from '../../src/features/competitions/organizer/export';

describe('organizer export', () => {
  afterEach(() => jest.restoreAllMocks());

  it('downloads a UTF-8 file with a byte-order mark, so a spreadsheet keeps the accents', () => {
    expect(csvFileContent('name\nHédi')).toBe('﻿name\nHédi');
    const a = { href: '', download: '', click: jest.fn() };
    const body = { appendChild: jest.fn(), removeChild: jest.fn() };
    const urls = { createObjectURL: jest.fn(() => 'blob:1'), revokeObjectURL: jest.fn() };
    downloadCsv('event-team.csv', 'name\nHédi', { createElement: () => a, body }, urls);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ href: 'blob:1', download: 'event-team.csv' });
    expect(a.click).toHaveBeenCalledTimes(1);
    expect(body.removeChild).toHaveBeenCalledWith(a);
  });

  it('on a phone the text goes to the share sheet', () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    exportCsv('event-team.csv', 'a,b');
    expect(share).toHaveBeenCalledWith({ title: 'event-team.csv', message: 'a,b' });
  });

  it('a browser without a share sheet (most computers) copies the text instead', async () => {
    const share = jest.spyOn(Share, 'share');
    const writeText = jest.fn(async () => {});
    expect(await shareOrCopy('Sousse Throwdown\nlink', { os: 'web', nav: { clipboard: { writeText } } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Sousse Throwdown\nlink');
    expect(share).not.toHaveBeenCalled();
    expect(await shareOrCopy('x', { os: 'web', nav: {} })).toBe('failed');
  });

  it('a phone, or a browser with a share sheet, opens the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    expect(await shareOrCopy('x', { os: 'ios' })).toBe('shared');
    expect(await shareOrCopy('y', { os: 'web', nav: { share: () => Promise.resolve() } })).toBe('shared');
    expect(share).toHaveBeenCalledTimes(2);
  });
});
