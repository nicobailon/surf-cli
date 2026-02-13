import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { formatJsonOutput } = require('../../native/json-output.cjs');

describe('formatJsonOutput', () => {
    it('emits valid JSON for string output', () => {
        const output = formatJsonOutput('OK');
        expect(() => JSON.parse(output)).not.toThrow();
        expect(JSON.parse(output)).toBe('OK');
    });

    it('emits valid JSON for undefined', () => {
        const output = formatJsonOutput(undefined);
        expect(JSON.parse(output)).toBeNull();
    });

    it('emits valid JSON for objects', () => {
        const payload = { ok: true, n: 3 };
        const output = formatJsonOutput(payload);
        expect(JSON.parse(output)).toEqual(payload);
    });

    it('escapes quotes correctly', () => {
        const output = formatJsonOutput('He said "hi"');
        expect(JSON.parse(output)).toBe('He said "hi"');
    });
});
