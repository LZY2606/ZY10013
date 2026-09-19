import {
  createTranslatorFactory,
  ParsingInstruction,
  Condition,
  ITSELF,
  OperatorRegistry,
  normalizeOperatorNames,
} from '@ucast/core';
import {
  MongoQuery,
  MongoQueryParser,
  MongoQueryFieldOperators,
  allParsingInstructions,
  defaultParsers,
} from '@ucast/mongo';
import {
  createJsInterpreter,
  interpreterRegistry,
  JsInterpreter,
  JsInterpretationOptions,
  compare
} from '@ucast/js';

type ThingFilter<T> = {
  (object: T): boolean
  ast: Condition
};

interface HasToJSON {
  toJSON(): unknown
}

function toPrimitive(value: unknown) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (value && typeof (value as HasToJSON).toJSON === 'function') {
    return (value as HasToJSON).toJSON();
  }

  return value;
}

const comparePrimitives: typeof compare = (a, b) => compare(toPrimitive(a), toPrimitive(b));

export interface FactoryOptions extends JsInterpretationOptions {
  forPrimitives: boolean
}

export type Filter = <
  T = Record<string, unknown>,
  Q extends MongoQuery<T> = MongoQuery<T>
>(query: Q) => ThingFilter<T>;

export type PrimitiveMongoQuery<T> = MongoQueryFieldOperators<T> & Partial<{
  $and: MongoQueryFieldOperators<T>[],
  $or: MongoQueryFieldOperators<T>[],
  $nor: MongoQueryFieldOperators<T>[]
}>;
export type PrimitiveFilter = <
  T,
  Q extends PrimitiveMongoQuery<T> = PrimitiveMongoQuery<T>
>(query: Q) => ThingFilter<T>;

type FilterType<T extends { forPrimitives?: true }> = T['forPrimitives'] extends true
  ? PrimitiveFilter
  : Filter;

type ParsingInstructions = Record<string, ParsingInstruction<any, any>> | OperatorRegistry<any>;
type Interpreters = Record<string, JsInterpreter<any>> | OperatorRegistry<JsInterpreter<any>>;

export function createFactory<
  T extends ParsingInstructions,
  I extends Interpreters,
  P extends { forPrimitives?: true }
>(instructions: T, interpreters: I, options?: Partial<FactoryOptions> & P): FilterType<P> {
  const parser = new MongoQueryParser(instructions);
  const interpret = createJsInterpreter(interpreters, {
    compare: comparePrimitives,
    ...options
  });

  if (options && options.forPrimitives) {
    const params = { field: ITSELF };
    const parse = parser.parse;
    parser.setParse(query => parse(query, params));
  }

  return createTranslatorFactory(parser.parse, interpret) as any;
}

export const guard = createFactory(allParsingInstructions, interpreterRegistry);

const fieldCompound: ParsingInstruction = { type: 'field', parse: defaultParsers.compound };
const primitivesRegistry = normalizeOperatorNames({
  ...allParsingInstructions,
  $and: fieldCompound,
  $or: fieldCompound,
  $nor: fieldCompound,
}, name => name.slice(1));

export const squire = createFactory(primitivesRegistry, interpreterRegistry, {
  forPrimitives: true
});

export const filter = guard; // TODO: remove in next major version
