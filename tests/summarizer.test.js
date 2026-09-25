const {
  summaryWords,
  contentWords,
  tidySentence,
  splitSentences,
  stripLeadingDiscourse,
  collapseDisfluency,
  splitRunOns,
  summarizeToBullets,
  createTranscriptSegments,
  buildMeetingSummary,
  renderMeetingSummary,
} = require('../public/js/summarizer');

describe('summaryWords', () => {
  test('lowercases and tokenises, keeping apostrophes and digits', () => {
    expect(summaryWords("We'll ship 3 builds.")).toEqual(["we'll", 'ship', '3', 'builds']);
  });

  test('returns an empty array for empty / punctuation-only input', () => {
    expect(summaryWords('')).toEqual([]);
    expect(summaryWords('... !!!')).toEqual([]);
  });
});

describe('contentWords', () => {
  test('drops stopwords and tokens of 2 chars or fewer', () => {
    expect(contentWords('We will go to the bigger office')).toEqual(['bigger', 'office']);
  });
});

describe('tidySentence', () => {
  test('capitalises, collapses whitespace and adds terminal punctuation', () => {
    expect(tidySentence('  ship   the   release  ')).toBe('Ship the release.');
  });

  test('keeps existing terminal punctuation', () => {
    expect(tidySentence('is it ready?')).toBe('Is it ready?');
  });
});

describe('splitSentences', () => {
  test('splits on terminal punctuation', () => {
    expect(splitSentences('Hello there. How are you? Fine!')).toEqual([
      'Hello there.',
      'How are you?',
      'Fine!',
    ]);
  });

  test('splits on newlines (Whisper one-sentence-per-line output)', () => {
    expect(splitSentences('first line\nsecond line\n\nthird line')).toEqual([
      'first line',
      'second line',
      'third line',
    ]);
  });
});

describe('stripLeadingDiscourse', () => {
  test('removes a single leading discourse marker', () => {
    expect(stripLeadingDiscourse('So we shipped the release.')).toBe('we shipped the release.');
    expect(stripLeadingDiscourse('And then it broke.')).toBe('then it broke.');
  });

  test('removes stacked leading markers', () => {
    expect(stripLeadingDiscourse('Okay, well, basically we are done.')).toBe('we are done.');
  });

  test('leaves substantive openings untouched', () => {
    expect(stripLeadingDiscourse('Sarah owns the migration.')).toBe('Sarah owns the migration.');
  });

  test('falls back to the original when everything would be stripped', () => {
    expect(stripLeadingDiscourse('So, well,')).toBe('So, well,');
  });
});

describe('collapseDisfluency', () => {
  test('collapses immediately repeated words (space or comma separated)', () => {
    expect(collapseDisfluency('a high, high, high level')).toBe('a high level');
    expect(collapseDisfluency('the the the plan')).toBe('the plan');
  });

  test('removes self-correction interjections', () => {
    expect(collapseDisfluency('optimise your habit, excuse me, your app')).toBe('optimise your habit, your app');
  });

  test('leaves clean text unchanged', () => {
    expect(collapseDisfluency('we agreed to delay the launch')).toBe('we agreed to delay the launch');
  });
});

describe('splitRunOns', () => {
  test('leaves short sentences intact', () => {
    const s = 'We agreed to delay the launch by a week.';
    expect(splitRunOns(s)).toEqual([s]);
  });

  test('splits a long run-on at a strong discourse boundary', () => {
    const s = 'The migration is the use case we found best fits gaming and academic work, ' +
      'but at a high level there are many reasons developers lean towards local AI optimisation today';
    const parts = splitRunOns(s);
    expect(parts.length).toBe(2);
    expect(parts[1].startsWith('but')).toBe(true);
  });

  test('keeps the whole sentence when a split would create a tiny fragment', () => {
    const s = 'This is a fairly long sentence about the roadmap and the budget review and the hiring plan for the next quarter and well beyond that, but no.';
    expect(splitRunOns(s)).toEqual([s]);
  });
});

describe('summarizeToBullets', () => {
  test('returns an empty string for empty input', () => {
    expect(summarizeToBullets('')).toBe('');
    expect(summarizeToBullets('   ')).toBe('');
    expect(summarizeToBullets(null)).toBe('');
  });

  test('bullets a single sentence as-is, tidied', () => {
    expect(summarizeToBullets('we agreed to ship on friday')).toBe(
      '- We agreed to ship on friday.'
    );
  });

  test('every output line is a Markdown bullet', () => {
    const transcript = [
      'We kicked off by reviewing the roadmap for the next quarter.',
      'The team is worried about the database migration timeline.',
      'Sarah will own the migration and report back next week.',
      'We decided to delay the launch until the migration is verified.',
      'Marketing needs the final dates before they can book the campaign.',
      'Everyone agreed the new onboarding flow looks much cleaner now.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    lines.forEach((line) => expect(line.startsWith('- ')).toBe(true));
  });

  test('keeps bullets in chronological order', () => {
    const transcript = [
      'Alpha point about the quarterly roadmap and the budget review.',
      'Beta point about the database migration risks and the timeline.',
      'Gamma point about the marketing campaign launch dates and booking.',
      'Delta point about the onboarding redesign and the user feedback.',
      'Epsilon point about hiring two engineers for the platform team.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    const positions = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']
      .map((word) => out.indexOf(word))
      .filter((idx) => idx !== -1);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  test('surfaces action-item sentences', () => {
    const transcript = [
      'The weather was nice and the coffee in the kitchen was good today.',
      'We chatted about the football results from the weekend for a while.',
      'The office plants are looking healthy after the new watering schedule.',
      'Priya will send the signed contract to the client by Friday.',
      'Someone mentioned the parking lot is being repainted next month.',
      'The vending machine finally has the good snacks back in stock.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    expect(out).toContain('Priya will send the signed contract');
  });

  test('de-duplicates near-identical sentences', () => {
    const transcript = [
      'We need to finish the security audit before the release goes out.',
      'We must finish the security audit before the release goes out.',
      'The design team shipped the new dashboard layout this morning.',
      'Customer support reported a spike in tickets about slow logins.',
      'The infrastructure team upgraded the database cluster overnight.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    const auditBullets = out
      .split('\n')
      .filter((line) => /security audit/i.test(line));
    expect(auditBullets.length).toBeLessThanOrEqual(1);
  });

  test('is deterministic for the same input', () => {
    const transcript = [
      'We reviewed the quarterly numbers and revenue is up twelve percent.',
      'The churn rate increased slightly in the enterprise segment though.',
      'Dev will investigate the slow checkout flow reported by three customers.',
      'We agreed to prioritise the mobile redesign for the next sprint.',
      'Finance needs the updated forecast before the board meeting on Tuesday.',
    ].join(' ');

    expect(summarizeToBullets(transcript)).toBe(summarizeToBullets(transcript));
  });

  test('down-weights presentation/navigation filler', () => {
    const transcript = [
      'Okay I am going to move to the next slide so you can see the menu.',
      'I will now hand it over to Michael to walk you through the details.',
      'The headline decision is that we will ship the new compiler in Q3.',
      'Priya needs to finish the security audit before the release ships.',
      'Let me go back to the previous slide for just a quick second here.',
      'The team agreed the local inference path cuts cloud costs sharply.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    expect(out).not.toMatch(/next slide|previous slide|hand it over/i);
    expect(out).toContain('ship the new compiler');
  });

  test('bare future chatter is not boosted without a concrete who/when', () => {
    const transcript = [
      'I am going to walk you through the general overview of the topic now.',
      'We are going to talk about a few different things in this session today.',
      'The database migration is the single biggest blocker for the launch.',
      'Revenue grew by fifteen percent across the enterprise customer segment.',
      'Sarah will own the migration and report the status back by Friday.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    expect(out).toContain('Sarah will own the migration');
    expect(out).not.toMatch(/walk you through/i);
  });

  test('groups follow-up commitments under an Action items heading', () => {
    const transcript = [
      'The database migration is the single biggest blocker for the whole launch.',
      'Revenue grew by fifteen percent across the enterprise customer segment.',
      'The new onboarding flow tested much better with the pilot group last week.',
      'I will chase the vendor and find out when the driver fix actually lands.',
      'Let me double check whether the consent suppression change has shipped yet.',
      'I need to pull the usage numbers for the cloud touch interface this week.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    expect(out).toContain('- **Key points**');
    expect(out).toContain('- **Action items**');
    // The action heading must precede the commitment bullets it introduces.
    expect(out.indexOf('**Action items**')).toBeLessThan(out.indexOf('I will chase the vendor'));
    // Every emitted line is still a valid Markdown bullet.
    out.split('\n').forEach((line) => expect(line.startsWith('- ')).toBe(true));
  });

  test('does not filter personal context using a global small-talk word list', () => {
    const transcript = [
      'The weather has been amazing this week and I went surfing every morning.',
      'The water was crystal clear and I saw a whole pot full of crabs out there.',
      'It is so warm now, honestly the summer here keeps getting hotter every year.',
      'The headline decision is that we will ship the new compiler in Q3 as planned.',
      'The database migration is the single biggest blocker holding up the release.',
      'Revenue grew by fifteen percent across the enterprise customer segment though.',
    ].join(' ');

    const out = summarizeToBullets(transcript);
    expect(out).toContain('ship the new compiler');
    const summary = buildMeetingSummary(transcript);
    expect(summary.items.some((item) => /surfing/.test(item.text))).toBe(true);
  });
});

describe('evidence-backed meeting notes', () => {
  test('keeps source IDs stable when complete transcript segments are appended', () => {
    const first = 'Yeah.\nSarah owns it.\nShip it.';
    expect(createTranscriptSegments(first + '\nMonday instead.').slice(0, 3))
      .toEqual(createTranscriptSegments(first));
    const summary = buildMeetingSummary(first);
    expect(summary.items[0].evidence).toEqual([{ segmentId: 'S2', quote: 'Sarah owns it.' }]);
  });

  test('rejects invalid transcript types rather than silently returning a summary', () => {
    expect(() => buildMeetingSummary({ text: 'Hello' })).toThrow(TypeError);
  });

  test('keeps a negative reply attached to the question without inventing a decision', () => {
    const summary = buildMeetingSummary('Can we launch on Friday?\nNo.\nWe need another security review.');
    expect(summary.items[0]).toMatchObject({
      kind: 'discussion', status: 'unclear', text: 'Can we launch on Friday? No.',
      evidence: [{ segmentId: 'S1' }, { segmentId: 'S2' }]
    });
    expect(renderMeetingSummary(summary)).toContain('Can we launch on Friday? No.');
  });

  test('uses the answer rather than the question for action ownership and due date', () => {
    const summary = buildMeetingSummary('Will Sarah send the report by Monday? Priya will send the report by Thursday.');
    expect(summary.items[0]).toMatchObject({ kind: 'action', owner: 'Priya', due: 'Thursday' });
  });

  test('extracts named owners, explicit deadlines and speaker labels', () => {
    const summary = buildMeetingSummary("Priya will send the signed contract by Friday.\nSarah: I'll review the migration by tomorrow.\nI'll chase the vendor.");
    expect(summary.items.map((item) => [item.kind, item.owner, item.due])).toEqual([
      ['action', 'Priya', 'Friday'], ['action', 'Sarah', 'tomorrow'], ['action', null, null]
    ]);
  });

  test('keeps short commitments and an explicit correction exchange', () => {
    const summary = buildMeetingSummary('Ship it.\nMonday instead.\nSarah owns it.');
    expect(summary.items[0].status).toBe('superseded');
    expect(summary.items[1]).toMatchObject({
      kind: 'decision', status: 'confirmed', supersedes: 'F1',
      text: 'Ship it. Monday instead.', owner: null, due: null
    });
    expect(summary.items[2]).toMatchObject({ kind: 'action', owner: 'Sarah' });
    expect(renderMeetingSummary(summary)).toContain('Monday instead.');
  });

  test('never treats a proposal or missing agreement as a confirmed decision', () => {
    const summary = buildMeetingSummary("Maybe we should ship on Monday.\nWe haven't decided on the budget.\nWe did not agree to approve the purchase.");
    expect(summary.items.every((item) => item.status === 'tentative')).toBe(true);
    expect(renderMeetingSummary(summary)).toContain('Proposals (not confirmed)');
  });

  test('does not swallow a definite action immediately following a proposal', () => {
    const summary = buildMeetingSummary('Maybe we should delay.\nSarah owns it.');
    expect(summary.items.map((item) => item.kind)).toEqual(['proposal', 'action']);
  });

  test('keeps explicit agreement with the proposal it confirms', () => {
    expect(buildMeetingSummary('We should ship Monday.\nAgreed.').items[0])
      .toMatchObject({ kind: 'decision', status: 'confirmed', text: 'We should ship Monday. Agreed.' });
  });

  test('does not resolve an open question with an unrelated short statement', () => {
    expect(buildMeetingSummary('Who owns the security review?\nThe launch looks good.').items[0].kind).toBe('question');
  });

  test('does not join a chunk fragment to a different labelled speaker', () => {
    const summary = buildMeetingSummary('We need to.\nSarah: I will review the report.');
    expect(summary.items).toHaveLength(2);
    expect(summary.items[1].owner).toBe('Sarah');
  });

  test('does not mark a decision superseded by an unrelated correction or a proposal', () => {
    const summary = buildMeetingSummary('We agreed to ship on Friday.\nCorrection, the catering budget is $500.\nMaybe we should ship on Monday instead.');
    expect(summary.items[0].status).toBe('confirmed');
    expect(summary.items.every((item) => !item.supersedes)).toBe(true);
  });

  test('does not merge negated statements or different dates, amounts and owners', () => {
    const summary = buildMeetingSummary('We agreed to spend $100.\nWe agreed to spend $1000.\nWe agreed not to spend $1000.\nPriya will send the report by Friday.\nSarah will send the report by Friday.\nSarah will send the report by Monday.');
    expect(summary.items).toHaveLength(6);
  });

  test('keeps more than six actions and seven decisions in brief and full output', () => {
    const transcript = Array.from({ length: 12 }, (_, i) =>
      `Action item: review ticket ${i + 1}.\nWe agreed to approve project ${i + 1}.`).join('\n');
    const summary = buildMeetingSummary(transcript);
    expect(summary.items.filter((item) => item.kind === 'action')).toHaveLength(12);
    expect(summary.items.filter((item) => item.kind === 'decision')).toHaveLength(12);
    for (const brief of [false, true]) {
      const text = renderMeetingSummary(summary, { brief });
      for (let i = 1; i <= 12; i += 1) {
        expect(text).toContain(`review ticket ${i}.`);
        expect(text).toContain(`approve project ${i}.`);
      }
    }
  });

  test('keeps original wording and evidence for self-corrections and chunk seams', () => {
    const summary = buildMeetingSummary("We can't.\nrisk this.\nShip Friday, sorry, Monday.");
    expect(summary.items[0].evidence).toEqual([
      { segmentId: 'S1', quote: "We can't." }, { segmentId: 'S2', quote: 'risk this.' }
    ]);
    expect(summary.items[1].text).toBe('Ship Friday, sorry, Monday.');
  });

  test('includes exact source passages and unknown fields in reviewable Markdown', () => {
    const summary = buildMeetingSummary("I'll chase the vendor.\nWho owns the rollout?");
    const output = renderMeetingSummary(summary, { includeEvidence: true });
    expect(output).toContain('Owner: not specified. Due: not specified.');
    expect(output).toContain('- **Open questions**');
    expect(output).toContain("- [S1] I'll chase the vendor.");
    expect(output).toContain('- [S2] Who owns the rollout?');
    output.split('\n').forEach((line) => expect(line.startsWith('- ')).toBe(true));
  });

  test('represents each explicit agenda topic in the discussion highlights', () => {
    const summary = buildMeetingSummary('Topic: Migration\nThe database migration is blocked by vendor approval.\nTopic: Workload\nAlex is concerned about burnout before the summer holiday.');
    const output = renderMeetingSummary(summary);
    expect(output).toContain('vendor approval');
    expect(output).toContain('burnout');
    expect(summary.items.map((item) => item.topic)).toEqual(['Migration', 'Workload']);
  });
});
