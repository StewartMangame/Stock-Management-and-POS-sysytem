import 'dotenv/config';
console.log('TEST_DATABASE_URL:', process.env.TEST_DATABASE_URL ? 'SET' : 'NOT SET');
console.log('DATABASE_URL_TEST:', process.env.DATABASE_URL_TEST ? 'SET' : 'NOT SET');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : 'NOT SET');

