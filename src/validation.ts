import { IRules, ShieldRule, ILogicRule, IRule } from './types';
import { isRuleFunction, flattenObjectOf, isLogicRule } from './utils';

/**
 *
 * @param ruleTree
 *
 * Validates the rule tree declaration by checking references of rule
 * functions. We deem rule tree valid if no two rules with the same name point
 * to different rules.
 *
 */
export function validateRuleTree(
  ruleTree: IRules,
): { status: 'ok' } | { status: 'err'; message: string } {
  /* Helper functions */
  /**
   *
   * Recursively extracts Rules from LogicRule
   *
   * @param rule
   */
  function extractLogicRules(rule: ILogicRule): IRule[] {
    return rule.getRules().reduce<IRule[]>((acc, shieldRule) => {
      if (isLogicRule(shieldRule)) {
        return [...acc, ...extractLogicRules(shieldRule)];
      }
      return [...acc, shieldRule];
    }, []);
  }
  /**
   *
   * @param ruleTree
   *
   * Extracts rules from rule tree.
   *
   */
  function extractRules(tree: IRules): IRule[] {
    const resolvers = flattenObjectOf<ShieldRule>(tree, isRuleFunction);

    const rules = resolvers.reduce<IRule[]>((r, rule) => {
      if (isLogicRule(rule)) {
        return [...r, ...extractLogicRules(rule)];
      }
      return [...r, rule];
    }, []);

    return rules;
  }

  const rules = extractRules(ruleTree);

  const valid = rules.reduce<{ map: Map<string, IRule>; duplicates: string[] }>(
    ({ map, duplicates }, rule) => {
      if (!map.has(rule.name)) {
        return { map: map.set(rule.name, rule), duplicates };
      }
      if (!map.get(rule.name)!.equals(rule) && !duplicates.includes(rule.name)) {
        return {
          map: map.set(rule.name, rule),
          duplicates: [...duplicates, rule.name],
        };
      }
      return { map, duplicates };
    },
    { map: new Map<string, IRule>(), duplicates: [] },
  );

  if (valid.duplicates.length === 0) {
    return { status: 'ok' };
  }
  const duplicates = valid.duplicates.join(', ');
  return {
    status: 'err',
    message: `There seem to be multiple definitions of these rules: ${duplicates}`,
  };
}

export class ValidationError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(message: string) {
    super(message);
  }
}
