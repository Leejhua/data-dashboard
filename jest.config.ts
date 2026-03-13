import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Setup Next.js environment mocks if needed
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    // Transform files with ts-jest
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.seed.json', // Use the seed config which is CommonJS friendly
    }],
  },
};

export default config;
