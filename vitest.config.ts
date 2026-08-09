throw new Error(
  'There is no test suite at the repository root. Run the web workspace suite instead:\n' +
    '  npm test              (from anywhere in the repository)\n' +
    '  npx vitest            (from ./web)\n',
);
