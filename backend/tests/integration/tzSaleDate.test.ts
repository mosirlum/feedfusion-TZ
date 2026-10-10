import { tanzaniaDateAtCurrentTime } from '../../src/utils/tzDate';

// 2026-10-10 22:30 UTC == 2026-10-11 01:30 Tanzania (UTC+3)
const NIGHT = Date.UTC(2026, 9, 10, 22, 30, 0, 0);

describe('tanzaniaDateAtCurrentTime', () => {
  it("returns exactly `now` for Tanzania's own today, even when UTC is still on the previous day", () => {
    expect(tanzaniaDateAtCurrentTime('2026-10-11', NIGHT)).toBe(NIGHT);
  });

  it('is not accepted as today when it is the UTC date but already yesterday in Tanzania', () => {
    // 2026-10-10 is Tanzania-yesterday here: a day earlier than now, same wall time.
    expect(tanzaniaDateAtCurrentTime('2026-10-10', NIGHT)).toBe(NIGHT - 86400000);
  });

  it('puts tomorrow (Tanzania) in the future', () => {
    expect(tanzaniaDateAtCurrentTime('2026-10-12', NIGHT)!).toBeGreaterThan(NIGHT + 60_000);
  });

  it('rejects malformed and impossible dates', () => {
    expect(tanzaniaDateAtCurrentTime('2026-13-01', NIGHT)).toBeNull();
    expect(tanzaniaDateAtCurrentTime('2026-02-30', NIGHT)).toBeNull();
    expect(tanzaniaDateAtCurrentTime('yesterday', NIGHT)).toBeNull();
  });
});
