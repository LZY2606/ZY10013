import {
  CompoundCondition,
  FieldCondition,
  NamedInstruction,
  ParsingInstruction,
  CompoundInstruction,
  FieldInstruction,
  DocumentInstruction,
  Comparable,
  ITSELF,
  NULL_CONDITION,
  FieldParsingContext,
  optimizedCompoundCondition,
  ObjectQueryFieldParsingContext,
  ParsingContext,
  createOperatorRegistry,
} from '@ucast/core';
import type { MongoQuery } from './types';

export const $and: CompoundInstruction<MongoQuery<any>[]> = {
  type: 'compound',
  validate: ensureIsNonEmptyArray,
  parse(instruction, queries, context) {
    const conditions = parseCompoundInstruction(instruction, queries, context);
    return optimizedCompoundCondition(instruction.name, conditions);
  }
};
export const $nor: CompoundInstruction<MongoQuery<any>[]> = {
  type: 'compound',
  validate: ensureIsNonEmptyArray,
  parse(instruction, queries, context) {
    const conditions = parseCompoundInstruction(instruction, queries, context);
    return new CompoundCondition(instruction.name, conditions);
  }
};

function parseCompoundInstruction(
  instruction: NamedInstruction,
  queries: MongoQuery<any>[],
  context: ParsingContext<{}>
) {
  const conditions = new Array(queries.length);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    ensureIsObjectAtIndex(instruction, query, i);
    conditions[i] = context.parse(query);
  }

  return conditions;
}

export const $not: FieldInstruction<MongoQuery<any> | RegExp> = {
  type: 'field',
  validate(instruction, value) {
    const isValid = value && (value instanceof RegExp || value.constructor === Object);

    if (!isValid) {
      throw new Error(`"${instruction.name}" expects to receive either regular expression or object of field operators`);
    }
  },
  parse(instruction, value, context) {
    const condition = value instanceof RegExp
      ? new FieldCondition('regex' as typeof instruction.name, context.field, value)
      : context.parse(value, context);

    return new CompoundCondition(instruction.name, [condition]);
  },
};
export const $elemMatch: FieldInstruction<MongoQuery<any>, ObjectQueryFieldParsingContext> = {
  type: 'field',
  validate(instruction, value) {
    if (!value || value.constructor !== Object) {
      throw new Error(`"${instruction.name}" expects to receive an object with nested query or field level operators`);
    }
  },
  parse(instruction, value, { parse, field, hasOperators }) {
    const condition = hasOperators(value) ? parse(value, { field: ITSELF }) : parse(value);
    return new FieldCondition(instruction.name, field, condition);
  }
};

export const $size: FieldInstruction<number> = {
  type: 'field',
  validate: ensureIs('number')
};
export const $in: FieldInstruction<unknown[]> = {
  type: 'field',
  validate: ensureIsArray,
};
export const $mod: FieldInstruction<[number, number]> = {
  type: 'field',
  validate(instruction, value) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`"${instruction.name}" expects an array with 2 numeric elements`);
    }
  }
};

export const $exists: FieldInstruction<boolean> = {
  type: 'field',
  validate: ensureIs('boolean'),
};

export const $gte: FieldInstruction<Comparable> = {
  type: 'field',
  validate: ensureIsComparable
};

export const $eq: FieldInstruction = {
  type: 'field',
};

export interface RegExpFieldContext extends FieldParsingContext {
  query: {
    $options?: string
  }
}

export const $regex: FieldInstruction<string | RegExp, RegExpFieldContext> = {
  type: 'field',
  validate(instruction, value) {
    if (!(value instanceof RegExp) && typeof value !== 'string') {
      throw new Error(`"${instruction.name}" expects value to be a regular expression or a string that represents regular expression`);
    }
  },
  parse(instruction, rawValue, context) {
    const value = typeof rawValue === 'string'
      ? new RegExp(rawValue, context.query.$options || '')
      : rawValue;
    return new FieldCondition(instruction.name, context.field, value);
  }
};
export const $options: FieldInstruction = {
  type: 'field',
  parse: () => NULL_CONDITION,
};

export const $where: DocumentInstruction<() => boolean> = {
  type: 'document',
  validate: ensureIs('function'),
};

const instructionsRegistry = createOperatorRegistry<ParsingInstruction<any, any>>({
  $and,
  $nor,
  $not,
  $elemMatch,
  $size,
  $in,
  $mod,
  $exists,
  $gte,
  $eq,
  $regex,
  $options,
  $where,
})
  .alias('$or', '$and')
  .alias('$nin', '$in')
  .alias('$all', '$in')
  .alias('$gt', '$gte')
  .alias('$lt', '$gte')
  .alias('$lte', '$gte')
  .alias('$ne', '$eq');

export const $or = instructionsRegistry.get('$or') as typeof $and;
export const $nin = instructionsRegistry.get('$nin') as typeof $in;
export const $all = instructionsRegistry.get('$all') as typeof $in;
export const $gt = instructionsRegistry.get('$gt') as typeof $gte;
export const $lt = instructionsRegistry.get('$lt') as typeof $gte;
export const $lte = instructionsRegistry.get('$lte') as typeof $gte;
export const $ne = instructionsRegistry.get('$ne') as typeof $eq;

function ensureIsArray(instruction: NamedInstruction, value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error(`"${instruction.name}" expects value to be an array`);
  }
}

function ensureIsNonEmptyArray(instruction: NamedInstruction, value: unknown[]) {
  ensureIsArray(instruction, value);

  if (!value.length) {
    throw new Error(`"${instruction.name}" expects to have at least one element in array`);
  }
}

function ensureIsComparable(instruction: NamedInstruction, value: string | number | Date) {
  const isComparable = typeof value === 'string' || typeof value === 'number' || value instanceof Date;

  if (!isComparable) {
    throw new Error(`"${instruction.name}" expects value to be comparable (i.e., string, number or date)`);
  }
}

function ensureIs(type: string) {
  return (instruction: NamedInstruction, value: unknown) => {
    if (typeof value !== type) {
      throw new Error(`"${instruction.name}" expects value to be a "${type}"`);
    }
  };
}

function ensureIsObjectAtIndex(instruction: NamedInstruction, value: unknown, index: number) {
  const item = value as { constructor?: unknown } | null;

  if (!item || item.constructor !== Object) {
    throw new Error(`"${instruction.name}" expects item at index ${index} to be an object`);
  }
}
