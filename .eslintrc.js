module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parser: "babel-eslint",
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    "no-implicit-globals": "off",
    "no-unused-vars": "off",
    "no-trailing-spaces": "error",
    "no-debugger": "off",
    "prefer-const": 2,
    "semi": 2,
  },
};
