import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyLocation, type LocationInput } from '../src/core/classifier/location.ts';

const loc = (location: string | null, extra: Partial<LocationInput> = {}) => classifyLocation({ location, title: 'Medical Coder', description: '', ...extra });

describe('US location validation', () => {
  for (const l of ['United States', 'USA', 'US', 'Remote - United States', 'Remote, USA', 'Remote US', 'United States - Remote', 'US National', 'Nationwide']) {
    it(`accepts "${l}" as US nationwide`, () => {
      const r = loc(l);
      assert.equal(r.us_eligible, true, r.reason ?? '');
      assert.equal(r.scope, 'US nationwide');
    });
  }

  it('accepts "Anywhere in the U.S." and "Remote within the United States"', () => {
    assert.equal(loc('Anywhere in the U.S.').us_eligible, true);
    assert.equal(loc('Remote within the United States').us_eligible, true);
  });

  for (const [l, state] of [
    ['Remote - Texas', 'Texas'],
    ['Remote - California', 'California'],
    ['Remote - Florida', 'Florida'],
    ['Remote - New York', 'New York'],
    ['Remote, TX', 'Texas'],
  ]) {
    it(`records the state restriction for "${l}"`, () => {
      const r = loc(l);
      assert.equal(r.us_eligible, true);
      assert.equal(r.scope, `US - ${state} only`);
      assert.deepEqual(r.states, [state]);
    });
  }

  it('a plain city/state listing is marked as the listed location', () => {
    const r = loc('Dallas, TX', { countryHint: 'US' });
    assert.equal(r.us_eligible, true);
    assert.equal(r.scope, 'US - Texas (listed location)');
  });

  it('"New Mexico" is a US state, not Mexico', () => {
    const r = loc('Remote - New Mexico');
    assert.equal(r.us_eligible, true);
    assert.equal(r.scope, 'US - New Mexico only');
  });

  it('description state restrictions override a nationwide location', () => {
    const r = loc('United States', { description: 'Candidates must reside in the state of Florida.' });
    assert.equal(r.scope, 'US - Florida only');
  });

  it('records excluded states', () => {
    const r = loc('United States', { description: 'We are unable to hire candidates residing in California, New York or Washington.' });
    assert.equal(r.us_eligible, true);
    assert.ok(r.excluded_states.includes('California'));
    assert.ok(r.scope?.includes('excluding'));
  });

  it('worldwide and multi-country lists including the US are accepted', () => {
    assert.equal(loc('Worldwide').us_eligible, true);
    assert.equal(loc('North America').us_eligible, true);
    const multi = loc('USA, Canada');
    assert.equal(multi.us_eligible, true);
    assert.equal(multi.kind, 'multi_country');
  });

  it('platform-restricted search with an unspecific location is accepted', () => {
    assert.equal(loc('Remote', { countryHint: 'US' }).us_eligible, true);
  });
});

describe('non-US rejection', () => {
  for (const l of ['Remote Canada', 'Remote UK', 'Remote Europe', 'Remote LATAM', 'Remote India', 'Remote Philippines', 'Remote Pakistan', 'Remote EMEA', 'Toronto, ON', 'Markham (ON)']) {
    it(`rejects "${l}"`, () => {
      const r = loc(l);
      assert.equal(r.us_eligible, false);
      assert.equal(r.kind, 'non_us');
    });
  }

  it('rejects "Medical Coding Specialist - Toronto Remote" (non-US city in the title)', () => {
    const r = classifyLocation({ location: null, title: 'Medical Coding Specialist - Toronto Remote', description: '' });
    assert.equal(r.us_eligible, false);
    assert.equal(r.kind, 'non_us');
  });

  it('accepts a non-US listing only when the description explicitly opens it to US applicants', () => {
    const r = loc('Canada', { description: 'This role is also open to candidates located in the United States.' });
    assert.equal(r.us_eligible, true);
  });

  it('rejects a "Remote" listing whose description requires non-US residence', () => {
    const r = loc('Remote', { description: 'Candidates must be located in the Philippines to be considered.', countryHint: 'US' });
    assert.equal(r.us_eligible, false);
  });

  it('rejects Canadian job-board listings', () => {
    assert.equal(loc('Winnipeg (MB)', { countryHint: 'CA' }).us_eligible, false);
  });

  it('rejects listings with no evidence of US eligibility', () => {
    const r = loc('Remote');
    assert.equal(r.us_eligible, false);
    assert.equal(r.kind, 'unknown');
  });
});
