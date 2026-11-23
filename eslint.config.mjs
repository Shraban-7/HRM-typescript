import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      '.next/**/*',
      'node_modules/**/*',
      'src/**/*',
      'server/**/*',
      'scripts/**/*',
      '*.ts',
      '*.js',
      '*.mjs',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
