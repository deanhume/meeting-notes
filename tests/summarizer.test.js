const {
  summaryWords,
  contentWords,
  tidySentence,
  splitSentences,
  stripLeadingDiscourse,
  collapseDisfluency,
  splitRunOns,
  summarizeToBullets,
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
});
