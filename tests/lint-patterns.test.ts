import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Linter } from 'eslint';

const fromExpoLint = createRequire(createRequire(import.meta.url).resolve('eslint-config-expo/flat'));

test('legacy ESLint plugins still match JSX exceptions and forbidden import paths', () => {
  const messages = new Linter().verify(
    "import 'example/private/file'; import 'example/public/file'; const jsx = <><OK_NAME/><BAD_NAME/></>;",
    [{
      files: ['**/*.jsx'],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { import: fromExpoLint('eslint-plugin-import'), react: fromExpoLint('eslint-plugin-react') },
      rules: {
        'import/no-internal-modules': ['error', { forbid: ['**/private/**'] }],
        'react/jsx-pascal-case': ['error', { ignore: ['OK_*'] }],
      },
    }],
    'src/pattern-check.jsx',
  );
  assert.deepEqual(messages.map(message => message.ruleId), ['import/no-internal-modules', 'react/jsx-pascal-case']);
  assert.match(messages[0].message, /example\/private\/file/);
  assert.match(messages[1].message, /BAD_NAME/);
});
