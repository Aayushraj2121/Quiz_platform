import 'dotenv/config';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDirectUrl = process.env.TEST_DIRECT_URL;
const confirmation = process.env.TEST_DATABASE_CONFIRMATION;
const testSchema = process.env.TEST_DATABASE_SCHEMA;

if (
  !testDatabaseUrl ||
  !testDirectUrl ||
  confirmation !== 'quiz-platform-test' ||
  !testSchema ||
  !/^test_[a-z0-9_]+$/i.test(testSchema)
) {
  throw new Error(
    'Backend tests require PostgreSQL test URLs, TEST_DATABASE_CONFIRMATION=quiz-platform-test, and a TEST_DATABASE_SCHEMA beginning with test_'
  );
}

const withSchema = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('Backend test database URLs must use PostgreSQL');
  }
  url.searchParams.set('schema', testSchema);
  return url.toString();
};

process.env.DATABASE_URL = withSchema(testDatabaseUrl);
process.env.DIRECT_URL = withSchema(testDirectUrl);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??=
  'local-automated-test-secret-do-not-use-in-production-12345';
