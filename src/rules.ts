/* eslint-disable max-classes-per-file */
import * as Yup from 'yup';
import { GraphQLResolveInfo } from 'graphql';
import { isUndefined } from 'util';
import {
  IRuleFunction,
  IRule,
  IRuleOptions,
  ICache,
  IFragment,
  ICacheContructorOptions,
  IRuleConstructorOptions,
  ILogicRule,
  ShieldRule,
  IRuleResult,
  IOptions,
  IShieldContext,
} from './types';
// eslint-disable-next-line import/no-cycle
import { isLogicRule } from './utils';

export class Rule implements IRule {
  readonly name: string;

  private cache: ICache;
  private fragment?: IFragment;
  private func: IRuleFunction;

  constructor(name: string, func: IRuleFunction, constructorOptions: IRuleConstructorOptions) {
    const options = this.normalizeOptions(constructorOptions);

    this.name = name;
    this.func = func;
    this.cache = options.cache;
    this.fragment = options.fragment;
  }

  /**
   *
   * @param parent
   * @param args
   * @param ctx
   * @param info
   *
   * Resolves rule and writes to cache its result.
   *
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    try {
      /* Resolve */
      const res = await this.executeRule(parent, args, ctx, info, options);

      if (res instanceof Error) {
        return res;
      }
      if (typeof res === 'string') {
        return new Error(res);
      }
      if (res === true) {
        return true;
      }
      return false;
    } catch (err) {
      if (options.debug) {
        throw err;
      } else {
        return false;
      }
    }
  }

  /**
   *
   * @param rule
   *
   * Compares a given rule with the current one
   * and checks whether their functions are equal.
   *
   */
  equals(rule: Rule): boolean {
    return this.func === rule.func;
  }

  /**
   *
   * Extracts fragment from the rule.
   *
   */
  extractFragment(): IFragment | undefined {
    return this.fragment;
  }

  /**
   *
   * @param options
   *
   * Sets default values for options.
   *
   */
  private normalizeOptions(options: IRuleConstructorOptions): IRuleOptions {
    return {
      cache: options.cache !== undefined ? this.normalizeCacheOption(options.cache) : 'no_cache',
      fragment: options.fragment !== undefined ? options.fragment : undefined,
    };
  }

  /**
   *
   * @param cache
   *
   * This ensures backward capability of shield.
   *
   */
  private normalizeCacheOption(cache: ICacheContructorOptions): ICache {
    switch (cache) {
      case true: {
        return 'strict';
      }
      case false: {
        return 'no_cache';
      }
      default: {
        return cache;
      }
    }
  }

  /**
   * Executes a rule and writes to cache if needed.
   *
   * @param parent
   * @param args
   * @param ctx
   * @param info
   */
  private executeRule(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): string | boolean | Error | Promise<IRuleResult> {
    switch (typeof this.cache) {
      case 'function': {
        /* User defined cache function. */
        const key = `${this.name}-${this.cache(parent, args, ctx, info)}`;
        return this.writeToCache(key)(parent, args, ctx, info);
      }
      case 'string': {
        /* Standard cache option. */
        switch (this.cache) {
          case 'strict': {
            const key = options.hashFunction({ parent, args });

            return this.writeToCache(`${this.name}-${key}`)(parent, args, ctx, info);
          }
          case 'contextual': {
            return this.writeToCache(this.name)(parent, args, ctx, info);
          }
          case 'no_cache': {
            return this.func(parent, args, ctx, info);
          }
          default:
        }
        throw new Error(`Unsupported cache format: ${typeof this.cache}`);
      }
      /* istanbul ignore next */
      default: {
        throw new Error(`Unsupported cache format: ${typeof this.cache}`);
      }
    }
  }

  /**
   * Writes or reads result from cache.
   *
   * @param key
   */

  private writeToCache(
    key: string,
  ): (
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
  ) => string | boolean | Error | Promise<IRuleResult> {
    return (parent, args, ctx, info) => {
      // eslint-disable-next-line no-underscore-dangle
      if (!ctx._shield.cache[key]) {
        // eslint-disable-next-line no-underscore-dangle
        ctx._shield.cache[key] = this.func(parent, args, ctx, info);
      }
      // eslint-disable-next-line no-underscore-dangle
      return ctx._shield.cache[key];
    };
  }
}

export class InputRule<T> extends Rule {
  constructor(
    name: string,
    schema: (yup: typeof Yup, ctx: IShieldContext) => Yup.SchemaOf<T>,
    options?: any,
  ) {
    const validationFunction: IRuleFunction = (parent: unknown, args: any, ctx: IShieldContext) =>
      schema(Yup, ctx)
        .validate(args, options)
        .then(() => true)
        .catch((err: Error) => err);

    super(name, validationFunction, { cache: 'strict', fragment: undefined });
  }
}

export class LogicRule implements ILogicRule {
  private rules: ShieldRule[];

  constructor(rules: ShieldRule[]) {
    this.rules = rules;
  }

  /**
   * By default logic rule resolves to false.
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    return false;
  }

  /**
   * Evaluates all the rules.
   */
  async evaluate(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult[]> {
    const rules = this.getRules();
    const tasks = rules.map((rule) => rule.resolve(parent, args, ctx, info, options));

    return Promise.all(tasks);
  }

  /**
   * Returns rules in a logic rule.
   */
  getRules() {
    return this.rules;
  }

  /**
   * Extracts fragments from the defined rules.
   */
  extractFragments(): IFragment[] {
    const fragments = this.rules.reduce<IFragment[]>((f, rule) => {
      if (isLogicRule(rule)) {
        return f.concat(...rule.extractFragments());
      }

      const fragment = rule.extractFragment();
      if (fragment) return f.concat(fragment);

      return f;
    }, []);

    return fragments;
  }
}

// Extended Types

export class RuleOr extends LogicRule {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(rules: ShieldRule[]) {
    super(rules);
  }

  /**
   * Makes sure that at least one of them has evaluated to true.
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    const result = await this.evaluate(parent, args, ctx, info, options);

    if (result.every((res) => res !== true)) {
      const customError = result.find((res) => res instanceof Error);
      return customError || false;
    }
    return true;
  }
}

export class RuleAnd extends LogicRule {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(rules: ShieldRule[]) {
    super(rules);
  }

  /**
   * Makes sure that all of them have resolved to true.
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    const result = await this.evaluate(parent, args, ctx, info, options);

    if (result.some((res) => res !== true)) {
      const customError = result.find((res) => res instanceof Error);
      return customError || false;
    }
    return true;
  }
}

export class RuleChain extends LogicRule {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(rules: ShieldRule[]) {
    super(rules);
  }

  /**
   * Makes sure that all of them have resolved to true.
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    const result = await this.evaluate(parent, args, ctx, info, options);

    if (result.some((res) => res !== true)) {
      const customError = result.find((res) => res instanceof Error);
      return customError || false;
    }
    return true;
  }

  /**
   * Evaluates all the rules.
   */
  async evaluate(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult[]> {
    const rules = this.getRules();

    async function iterate([rule, ...otherRules]: ShieldRule[]): Promise<IRuleResult[]> {
      if (isUndefined(rule)) return [];
      return rule.resolve(parent, args, ctx, info, options).then((res) => {
        if (res !== true) {
          return [res];
        }
        return iterate(otherRules).then((ress) => ress.concat(res));
      });
    }

    return iterate(rules);
  }
}

export class RuleRace extends LogicRule {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(rules: ShieldRule[]) {
    super(rules);
  }

  /**
   * Makes sure that at least one of them resolved to true.
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    const result = await this.evaluate(parent, args, ctx, info, options);

    if (result.some((res) => res === true)) {
      return true;
    }
    const customError = result.find((res) => res instanceof Error);
    return customError || false;
  }

  /**
   * Evaluates all the rules.
   */
  async evaluate(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult[]> {
    const rules = this.getRules();

    async function iterate([rule, ...otherRules]: ShieldRule[]): Promise<IRuleResult[]> {
      if (isUndefined(rule)) return [];
      return rule.resolve(parent, args, ctx, info, options).then((res) => {
        if (res === true) {
          return [res];
        }
        return iterate(otherRules).then((ress) => ress.concat(res));
      });
    }

    return iterate(rules);
  }
}

export class RuleNot extends LogicRule {
  error?: Error;

  constructor(rule: ShieldRule, error?: Error) {
    super([rule]);
    this.error = error;
  }

  /**
   *
   * @param parent
   * @param args
   * @param ctx
   * @param info
   *
   * Negates the result.
   *
   */
  async resolve(
    parent: unknown,
    args: any,
    ctx: IShieldContext,
    info: GraphQLResolveInfo,
    options: IOptions,
  ): Promise<IRuleResult> {
    const [res] = await this.evaluate(parent, args, ctx, info, options);

    if (res instanceof Error) {
      return true;
    }
    if (res !== true) {
      return true;
    }
    if (this.error) return this.error;
    return false;
  }
}

export class RuleTrue extends LogicRule {
  constructor() {
    super([]);
  }

  /**
   *
   * Always true.
   *
   */
  async resolve(): Promise<IRuleResult> {
    return true;
  }
}

export class RuleFalse extends LogicRule {
  constructor() {
    super([]);
  }

  /**
   *
   * Always false.
   *
   */
  async resolve(): Promise<IRuleResult> {
    return false;
  }
}
