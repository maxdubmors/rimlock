import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import type { AST } from 'svelte-eslint-parser';
import type ts from 'typescript';

/**
 * `onclick={asyncFn}` on an HTML element drops the promise, so a rejection goes
 * unhandled. typescript-eslint's `no-misused-promises` catches this in JSX
 * only; this rule does it for Svelte templates (verification.md V4).
 */
export const noAsyncEventHandler = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'problem',
    messages: {
      asyncHandler:
        'This event handler returns a promise that nothing awaits. Handle it: `() => void save().catch(report)`.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function check(attribute: AST.SvelteAttribute | AST.SvelteShorthandAttribute): void {
      // A component prop may expect a promise; DOM event handlers never do.
      if (attribute.parent.parent.type !== 'SvelteElement') return;
      if (attribute.parent.parent.kind !== 'html') return;
      if (!/^on[a-z]/.test(attribute.key.name)) return;

      const handler =
        attribute.type === 'SvelteShorthandAttribute'
          ? attribute.value
          : attribute.value.length === 1 && attribute.value[0]?.type === 'SvelteMustacheTag'
            ? attribute.value[0].expression
            : undefined;
      if (handler === undefined) return;

      // svelte-eslint-parser hands typescript-eslint the same nodes under its own ESTree types.
      const node = handler as unknown as TSESTree.Node;
      if (returnsThenable(checker, services.getTypeAtLocation(node))) {
        context.report({ node, messageId: 'asyncHandler' });
      }
    }

    return { SvelteAttribute: check, SvelteShorthandAttribute: check };
  },
});

function returnsThenable(checker: ts.TypeChecker, type: ts.Type): boolean {
  return unionParts(type).some((part) =>
    part
      .getCallSignatures()
      .some((signature) =>
        unionParts(signature.getReturnType()).some((r) => isThenable(checker, r)),
      ),
  );
}

function isThenable(checker: ts.TypeChecker, type: ts.Type): boolean {
  const then = type.getProperty('then');
  return then !== undefined && checker.getTypeOfSymbol(then).getCallSignatures().length > 0;
}

function unionParts(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type];
}
