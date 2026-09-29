import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyRelevance, titleLooksRelevant } from '../src/core/classifier/relevance.ts';
import { DEFAULT_TITLES } from '../src/config/keywords.ts';

const HEALTH_DESC = 'Submit and follow up on claims with Medicare, Medicaid and commercial payers. Resolve denials, review EOBs and patient accounts. HIPAA compliance required.';
const CODING_DESC = 'Assign ICD-10-CM, CPT and HCPCS codes from medical records. CPC or CCS certification required (AAPC/AHIMA).';
const rel = (title: string, description = '', company = 'Example Health System') => classifyRelevance({ title, description, company }, DEFAULT_TITLES);

describe('keyword matching', () => {
  it('matches exact titles and lists every matched term, most specific first', () => {
    const r = rel('Medical Billing Specialist', HEALTH_DESC);
    assert.equal(r.relevant, true);
    assert.equal(r.matched_keyword, 'medical billing specialist');
    assert.ok(r.matched_keywords.includes('medical billing'));
    assert.equal(r.category, 'Medical Billing');
  });

  it('matches role families with healthcare context', () => {
    assert.equal(rel('Billing Rep I', HEALTH_DESC).relevant, true);
    assert.equal(rel('Revenue Cycle Analyst').relevant, true);
    assert.equal(rel('Credentialing Specialist').relevant, true);
    assert.equal(rel('Provider Enrollment Specialist', HEALTH_DESC).relevant, true);
    assert.equal(rel('Prior Authorization Specialist', HEALTH_DESC).relevant, true);
    assert.equal(rel('Reimbursement Specialist', HEALTH_DESC).relevant, true);
    assert.equal(rel('Patient Collections Representative', HEALTH_DESC).relevant, true);
    assert.equal(rel('EHR Support Specialist').relevant, true);
  });

  it('matches administrative titles through the description', () => {
    const r = rel('Patient Account Representative', `${HEALTH_DESC} Medical billing experience required; insurance claims submission.`);
    assert.equal(r.relevant, true);
    assert.equal(r.matches[0].via, 'description');
  });

  it('requires healthcare context for generic billing titles', () => {
    assert.equal(rel('Billing Specialist', 'Prepare invoices for attorneys and legal clients.', 'Smith & Jones LLP').relevant, false);
    assert.equal(rel('Billing Specialist', HEALTH_DESC).relevant, true);
  });

  it('supports custom terms with generic phrase matching', () => {
    const r = classifyRelevance({ title: 'Patient Access Representative', description: '', company: 'X' }, ['patient access']);
    assert.equal(r.relevant, true);
    assert.equal(r.category, 'Custom');
  });
});

describe('loose-match false positives are rejected', () => {
  const cases: [string, string][] = [
    ['Software Engineer - Revenue Platform', 'Build revenue platform services.'],
    ['Collections Developer', 'Develop the collections API.'],
    ['Coding Instructor', 'Teach kids to code in Scratch and Python.'],
    ['Insurance Sales Coordinator', 'Sell auto and home insurance policies.'],
    ['Senior Python Coder - Remote US', 'Write Python services.'],
    ['Epic Software Engineer', 'Build integrations with Epic EHR.'],
    ['Medical Billing Sales Representative', HEALTH_DESC],
  ];
  for (const [title, desc] of cases) {
    it(`"${title}" is not relevant`, () => {
      const r = rel(title, desc);
      assert.equal(r.relevant, false, `matched ${r.matched_keywords.join(', ')}`);
    });
  }
});

describe('IT / health-IT titles are not medical billing jobs', () => {
  // All were accepted from a live run before EXCLUDE_IT existed.
  const EPIC_DESC = `Build and support Epic Resolute HB/PB for hospital billing. ${HEALTH_DESC} Revenue cycle and medical billing workflows.`;
  const titles = [
    'Epic Application Analyst',
    'Epic Tapestry Configuration Analyst',
    'Epic Certified Lead Analyst, Resolute PB',
    'EPIC (Certified Resolute HB, Resolute PB Claims Analyst)',
    'Lead Epic Professional Billing Analyst',
    'Epic Hospital Billing Consultant',
    'Epic Revenue Cycle Manager',
    'Epic Interoperability Consultant',
    'Senior IT Systems Analyst - Epic Hospital Billing Administration / HB Admin',
    'Applications Support Analyst - Professional Billing',
    'Application Analyst, Revenue Cycle, Full Time, First Shift',
    'Senior Consultant - Meditech Analyst - Revenue Cycle',
    'Revenue Cycle Federal Technical Director',
    'IT Support Specialist Full Time',
    'IT-Business Systems Analyst (ERX build)',
    'Senior Application Analyst',
    'Clinical Systems Analyst - FCS',
    'Clinical Informatics Systems Analyst I - Epic Analyst - Cupid/Cardiology',
    'Clinical Service Desk Support - Remote (CA)',
    'System Specialist - Patient Access',
    'Senior EHR Support Analyst',
    'EMR Analyst II **Optime and Anesthesia** Remote',
    'Electronic Health Records Analyst',
    'eClinicalWorks (eCW) System Analyst',
  ];
  for (const title of titles) {
    it(`"${title}" is not relevant`, () => {
      const r = rel(title, EPIC_DESC);
      assert.equal(r.relevant, false, `matched ${r.matched_keywords.join(', ')}`);
      assert.equal(titleLooksRelevant(title, DEFAULT_TITLES), false);
    });
  }

  it('billing titles that mention systems, analysts or an EHR are still relevant', () => {
    assert.equal(rel('Revenue Cycle Analyst').relevant, true);
    assert.equal(rel('Senior Revenue Cycle Analyst Underpayments').relevant, true);
    assert.equal(rel('Credentialing & Enrollment Analyst I', HEALTH_DESC).relevant, true);
    assert.equal(rel('System Coding Manager', CODING_DESC).relevant, true);
    assert.equal(rel('REMOTE Revenue Cycle Manager (FQHC & Athena exp. req. $70-80K)').relevant, true);
    assert.equal(rel('Medical Coder and Biller MUST HAVE ECW EMR experience', CODING_DESC).relevant, true);
    assert.equal(rel('Support Specialist Lead (EHR platform billing support)', HEALTH_DESC).relevant, true);
  });
});

describe('non-healthcare senses of healthcare words do not count as context', () => {
  // Both were accepted from JobRight before these phrases were neutralised.
  it('visa "CPT, OPT" and "energy provider" do not make a utility billing job medical', () => {
    const desc =
      'Consumers Energy is a Michigan energy provider serving residential and commercial customers. Investigate billing, meter, and rate discrepancies. We are unable to hire individuals with CPT, OPT, or STEM OPT for this position.';
    assert.equal(rel('Billing Exception Spec', desc, 'Consumers Energy').relevant, false);
  });

  it('"patient, personable" and "data providers" do not make a fintech billing job medical', () => {
    const desc =
      'Market data platform. Own billing-related customer support, invoices and disputes, and exchange fees (e.g., paying data providers directly). A genuine customer service orientation — patient, personable. Experience in healthcare billing/insurance coordination is a plus.';
    assert.equal(rel('Billing Support Specialist', desc, 'Databento').relevant, false);
  });

  it('real healthcare uses of the same words still count', () => {
    const desc = 'Verify coverage for patients before visits, work with providers on CPT and ICD-10 coding questions, and post payments.';
    const r = rel('Billing Specialist', desc, 'Acme Physicians Group');
    assert.equal(r.relevant, true);
    assert.ok(r.healthcare_context >= 3);
  });
});

describe('medical coder vs software coder', () => {
  it('a coder with medical-coding context is a medical coder', () => {
    const r = rel('Coder II', CODING_DESC);
    assert.equal(r.relevant, true);
    assert.ok(r.matched_keywords.includes('medical coder'));
  });

  it('qualified coder titles match on their own', () => {
    assert.equal(rel('Risk Adjustment Coder').relevant, true);
    assert.equal(rel('Inpatient Coder - CCS').relevant, true);
  });

  it('a coder without medical-coding context is not relevant', () => {
    assert.equal(rel('Coder', 'Write clean JavaScript and TypeScript code for our web platform.', 'Acme Software').relevant, false);
    assert.equal(rel('Senior Python Coder - Remote US', CODING_DESC).relevant, false);
  });

  it('clinical titles do not match through context alone', () => {
    assert.equal(rel('Registered Nurse - Utilization Review', `${CODING_DESC} ${HEALTH_DESC}`).relevant, false);
  });
});

describe('title pre-screen', () => {
  it('keeps administrative titles and drops engineering titles', () => {
    assert.equal(titleLooksRelevant('Patient Account Rep', DEFAULT_TITLES), true);
    assert.equal(titleLooksRelevant('Frontend Developer', DEFAULT_TITLES), false);
  });
});
