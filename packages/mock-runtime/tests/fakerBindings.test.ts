import { describe, it, expect } from 'vitest';
import { buildFakerBindings, fieldToFakerCall } from '../src/fakerBindings.js';
import type { MockSchema } from '@visual-edit/shared';

describe('fieldToFakerCall', () => {
  it('maps known field names to faker calls', () => {
    expect(fieldToFakerCall('email', 'string')).toBe(`faker.internet.email()`);
    expect(fieldToFakerCall('firstName', 'string')).toBe(`faker.person.firstName()`);
    expect(fieldToFakerCall('id', 'string')).toBe(`faker.string.uuid()`);
    expect(fieldToFakerCall('createdAt', 'string')).toBe(`faker.date.recent().toISOString()`);
  });

  it('falls back to faker.lorem.word() for unknown string fields', () => {
    expect(fieldToFakerCall('bizarreField', 'string')).toBe(`faker.lorem.word()`);
  });

  it('handles number, integer, boolean types', () => {
    expect(fieldToFakerCall('age', 'integer')).toBe(`faker.number.int({ min: 18, max: 65 })`);
    expect(fieldToFakerCall('price', 'number')).toBe(`faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })`);
    expect(fieldToFakerCall('isActive', 'boolean')).toBe(`faker.datatype.boolean()`);
  });
});

describe('buildFakerBindings', () => {
  it('emits a function per schema returning an object literal', () => {
    const schemas: MockSchema[] = [
      {
        name: 'User',
        source: 'zod',
        shape: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            age: { type: 'integer' },
          },
        },
      },
    ];
    const code = buildFakerBindings(schemas);
    expect(code).toContain(`import { faker } from '@faker-js/faker';`);
    expect(code).toContain(`export function makeUser()`);
    expect(code).toContain(`id: faker.string.uuid()`);
    expect(code).toContain(`email: faker.internet.email()`);
    expect(code).toContain(`age: faker.number.int({ min: 18, max: 65 })`);
  });

  it('handles empty schema list', () => {
    const code = buildFakerBindings([]);
    expect(code).toContain(`import { faker } from '@faker-js/faker';`);
    expect(code).not.toContain('export function make');
  });
});
