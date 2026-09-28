import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyRemote } from '../src/core/classifier/remote.ts';
import type { RemoteHint } from '../src/models/job.ts';

const classify = (title: string, description = '', location: string | null = null, hints: RemoteHint[] = []) =>
  classifyRemote({ title, description, location, hints });

describe('remote classification', () => {
  it('fully remote: "100% Remote Medical Billing Specialist - United States"', () => {
    const r = classify('100% Remote Medical Billing Specialist - United States');
    assert.equal(r.remote_type, 'fully_remote');
    assert.ok(r.confidence >= 0.75);
  });

  it('fully remote: work-from-home wording in the description', () => {
    assert.equal(classify('Medical Coder', 'This is a work from home position. Home-based employees receive equipment.').remote_type, 'fully_remote');
  });

  it('fully remote: platform remote filter alone gives a moderate-confidence remote', () => {
    const r = classify('Credentialing Specialist', '', 'Chicago, IL', [{ kind: 'source_remote_filter', detail: 'LinkedIn f_WT=2' }]);
    assert.equal(r.remote_type, 'fully_remote');
    assert.equal(r.confidence, 0.7);
  });

  it('negated hybrid wording does not make a job hybrid', () => {
    assert.equal(classify('Medical Biller', 'This is not a hybrid role. It is 100% remote.').remote_type, 'fully_remote');
    assert.equal(classify('Medical Biller', 'Fully remote. No office visits are required.').remote_type, 'fully_remote');
  });

  it('temporary onsite training followed by remote work stays fully remote (with a note)', () => {
    const r = classify('Remote Medical Coder', 'Onsite training for the first two weeks, then remote. You will work from home after training.');
    assert.equal(r.remote_type, 'fully_remote');
    assert.ok(r.notes.some((n) => /training/.test(n)));
  });
});

describe('hybrid rejection', () => {
  it('"Remote Medical Biller - must work onsite every Tuesday" is hybrid', () => {
    assert.equal(classify('Remote Medical Biller - must work onsite every Tuesday').remote_type, 'hybrid');
    assert.equal(classify('Remote Medical Biller', 'Candidates must work onsite every Tuesday.').remote_type, 'hybrid');
  });

  it('N days in office is hybrid', () => {
    assert.equal(classify('Medical Billing Specialist', 'Remote role with 2 days per week in the office.').remote_type, 'hybrid');
    assert.equal(classify('Medical Billing Specialist', 'Schedule: 3 days onsite, 2 days remote.').remote_type, 'hybrid');
    assert.equal(classify('Revenue Cycle Analyst', 'You will be onsite 2 days a week.').remote_type, 'hybrid');
  });

  it('hybrid in title or location is hybrid', () => {
    assert.equal(classify('Medical Coder (Hybrid)').remote_type, 'hybrid');
    assert.equal(classify('Medical Coder', '', 'Hybrid remote in Dallas, TX').remote_type, 'hybrid');
    assert.equal(classify('Medical Coder', '', null, [{ kind: 'structured_hybrid', detail: 'Hybrid work' }]).remote_type, 'hybrid');
  });

  it('occasional office attendance and local-only requirements are hybrid', () => {
    assert.equal(classify('Remote Credentialing Coordinator', 'Occasional office attendance required for team meetings.').remote_type, 'hybrid');
    assert.equal(classify('Billing Coordinator (Must be local to Sacramento)', '', 'Remote').remote_type, 'hybrid');
    assert.equal(classify('Remote Biller', 'Must live within 50 miles of our Dallas office.').remote_type, 'hybrid');
  });

  it('required onsite training without a remote transition is hybrid', () => {
    assert.equal(classify('Remote Medical Coder', 'Onsite training is required at our Phoenix facility.').remote_type, 'hybrid');
  });

  it('conflicting remote + onsite requirement resolves conservatively to hybrid', () => {
    assert.equal(classify('Remote Medical Biller', 'You must work onsite at the clinic.').remote_type, 'hybrid');
  });
});

describe('onsite and unclear', () => {
  it('explicit onsite / not remote', () => {
    assert.equal(classify('Medical Biller', 'This position is not remote.').remote_type, 'onsite');
    assert.equal(classify('Medical Biller', '', 'On-site - Denver, CO').remote_type, 'onsite');
    assert.equal(classify('Medical Biller', 'Work Location: In person').remote_type, 'onsite');
  });

  it('a single bare "remote" mention in a long description is unclear, not remote', () => {
    assert.equal(classify('Medical Biller', 'Our billing team uses remote deposit capture for payments.').remote_type, 'unclear');
  });

  it('no indicators with a physical location is onsite', () => {
    assert.equal(classify('Medical Biller', 'Process claims.', 'Boise, ID').remote_type, 'onsite');
  });
});
