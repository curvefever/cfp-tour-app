import { describe, expect, it } from 'vitest';
import { parseRulesInline, parseRulesText } from './rules-text';

const text = (value: string) => ({ kind: 'text', text: value }) as const;

describe('parseRulesInline', () => {
  it('leaves plain text as it is', () => {
    expect(parseRulesInline('No pausing in the final.')).toEqual([text('No pausing in the final.')]);
  });

  it('reads **bold**', () => {
    expect(parseRulesInline('Be **on time** please')).toEqual([
      text('Be '),
      { kind: 'bold', text: 'on time' },
      text(' please'),
    ]);
  });

  it('reads an http or https link, and several constructs in order', () => {
    expect(
      parseRulesInline(
        'See [the rules](https://info.curvefever.pro/rules) and [a site](http://example.com/a?b=1).',
      ),
    ).toEqual([
      text('See '),
      { kind: 'link', text: 'the rules', href: 'https://info.curvefever.pro/rules' },
      text(' and '),
      { kind: 'link', text: 'a site', href: 'http://example.com/a?b=1' },
      text('.'),
    ]);
  });

  it('shows a javascript: link as plain text', () => {
    expect(parseRulesInline('[click](javascript:alert(1))')).toEqual([text('[click](javascript:alert(1))')]);
    expect(parseRulesInline('[x](JAVASCRIPT:alert(1))')).toEqual([text('[x](JAVASCRIPT:alert(1))')]);
  });

  it('shows other kinds of address, and an address with spaces, as plain text', () => {
    for (const bad of [
      '[a](data:text/html;base64,AAAA)',
      '[a](file:///etc/passwd)',
      '[a](ftp://example.com)',
      '[a](//example.com)',
      '[a](/relative)',
      '[a](https://exa mple.com)',
    ]) {
      expect(parseRulesInline(bad)).toEqual([text(bad)]);
    }
  });

  it('shows raw HTML as plain text', () => {
    expect(parseRulesInline('<b>bold</b> <img src=x onerror=alert(1)> <script>x</script>')).toEqual([
      text('<b>bold</b> <img src=x onerror=alert(1)> <script>x</script>'),
    ]);
  });

  it('leaves a lone or unclosed ** alone', () => {
    expect(parseRulesInline('2 ** 3')).toEqual([text('2 ** 3')]);
    expect(parseRulesInline('**open')).toEqual([text('**open')]);
  });
});

describe('parseRulesText', () => {
  it('splits paragraphs on blank lines and keeps single line breaks inside a paragraph', () => {
    expect(parseRulesText('First line\nsecond line\n\nNext paragraph')).toEqual([
      { kind: 'paragraph', lines: [[text('First line')], [text('second line')]] },
      { kind: 'paragraph', lines: [[text('Next paragraph')]] },
    ]);
  });

  it('reads "- " lines as a list, with formatting inside the items', () => {
    expect(parseRulesText('- one\n- **two**\n- [three](https://example.com)')).toEqual([
      {
        kind: 'list',
        items: [
          [text('one')],
          [{ kind: 'bold', text: 'two' }],
          [{ kind: 'link', text: 'three', href: 'https://example.com' }],
        ],
      },
    ]);
  });

  it('ends a paragraph where a list starts, and a list where text starts', () => {
    expect(parseRulesText('Rules:\n- one\n- two\nThat is all')).toEqual([
      { kind: 'paragraph', lines: [[text('Rules:')]] },
      { kind: 'list', items: [[text('one')], [text('two')]] },
      { kind: 'paragraph', lines: [[text('That is all')]] },
    ]);
  });

  it('does not take a dash without a space, or an indented one, for a bullet', () => {
    expect(parseRulesText('-no\n  - indented')).toEqual([
      { kind: 'paragraph', lines: [[text('-no')], [text('  - indented')]] },
    ]);
  });

  it('handles Windows line breaks and extra blank lines', () => {
    expect(parseRulesText('a\r\n\r\n\r\n\r\nb')).toEqual([
      { kind: 'paragraph', lines: [[text('a')]] },
      { kind: 'paragraph', lines: [[text('b')]] },
    ]);
  });

  it('is empty for an empty or blank text', () => {
    expect(parseRulesText('')).toEqual([]);
    expect(parseRulesText('  \n \n')).toEqual([]);
  });
});
