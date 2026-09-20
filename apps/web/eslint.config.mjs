import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      'services/**',
      'src/payload-types.ts',
      'cloudflare-env.d.ts',
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  ...nextCoreWebVitals,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import/no-anonymous-default-export': 'off',
      '@next/next/no-img-element': 'off',
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-location-assign-relative-destination': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['src/migrations/**'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    files: ['scripts/**', 'src/seed/**', 'src/lib/logError.ts'],
    rules: { 'no-console': 'off' },
  },
]
