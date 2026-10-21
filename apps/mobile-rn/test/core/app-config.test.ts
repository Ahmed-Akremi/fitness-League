const fs = jest.requireActual<typeof import('fs')>('fs');
const path = jest.requireActual<typeof import('path')>('path');

describe('app config', () => {
  it('version 1 is iPhone only (owner, Q2): the phone layout is not designed for iPad yet', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
    expect(app.expo.ios.supportsTablet).toBe(false);
  });
});
