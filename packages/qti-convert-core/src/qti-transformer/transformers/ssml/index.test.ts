import convertSSMLToDataAttributes from '.';
import * as cheerio from 'cheerio';
import { expect, test } from 'vitest';

test('convert <ssml:sub> to <span data-ssml-sub-alias="...">', () => {
  const input = `<p>Temperature is <ssml:sub alias="degrees Celsius">°C</ssml:sub>.</p>`;
  const expectedOutput = `<p>Temperature is <span data-ssml-sub-alias="degrees Celsius">&#xb0;C</span>.</p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});

test('convert <ssml:break> to <span data-ssml-break-time="...">', () => {
  const input = `<p>Wait<ssml:break time="1s"/>now.</p>`;
  const expectedOutput = `<p>Wait<span data-ssml-break-time="1s"/>now.</p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});

test('convert <ssml:say-as> to <span data-ssml-say-as="...">', () => {
  const input = `<p>Call <ssml:say-as interpret-as="telephone">123456789</ssml:say-as>.</p>`;
  const expectedOutput = `<p>Call <span data-ssml-say-as="telephone">123456789</span>.</p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});

test('convert <ssml:phoneme> to <span data-ssml-phoneme-ph="...">', () => {
  const input = `<p>Pronounce <ssml:phoneme alphabet="ipa" ph="tɛst">test</ssml:phoneme>.</p>`;
  const expectedOutput = `<p>Pronounce <span data-ssml-phoneme-ph="t&#x25b;st" data-ssml-phoneme-alphabet="ipa">test</span>.</p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});

test('convert <ssml:prosody> to <span data-ssml-prosody-rate="...">', () => {
  const input = `<p><ssml:prosody rate="slow">Slow speech</ssml:prosody></p>`;
  const expectedOutput = `<p><span data-ssml-prosody-rate="slow">Slow speech</span></p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});

test('convert <ssml:emphasis> to <span data-ssml-emphasis-level="...">', () => {
  const input = `<p><ssml:emphasis level="strong">Important</ssml:emphasis></p>`;
  const expectedOutput = `<p><span data-ssml-emphasis-level="strong">Important</span></p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});

test('convert <ssml:voice> to <span data-ssml-voice-name="...">', () => {
  const input = `<p><ssml:voice name="Joanna">Hello</ssml:voice></p>`;
  const expectedOutput = `<p><span data-ssml-voice-name="Joanna">Hello</span></p>`;

  const $ = cheerio.load(input, { xmlMode: true });
  convertSSMLToDataAttributes($);
  expect($.html()).toBe(expectedOutput);
});
