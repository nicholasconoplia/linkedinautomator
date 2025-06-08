require('dotenv').config();
const { Pool } = require('pg');

// Database configuration
const getDatabaseConfig = () => {
  // Vercel sets these automatically
  if (process.env.POSTGRES_URL) {
    console.log('🔧 Using POSTGRES_URL for database connection');
    return {
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production'
    };
  }
  
  if (process.env.DATABASE_URL) {
    console.log('🔧 Using DATABASE_URL for database connection');
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
    };
  }

  // Additional Vercel PostgreSQL environment variables
  if (process.env.POSTGRES_PRISMA_URL) {
    console.log('🔧 Using POSTGRES_PRISMA_URL for database connection');
    return {
      connectionString: process.env.POSTGRES_PRISMA_URL,
      ssl: process.env.NODE_ENV === 'production'
    };
  }

  if (process.env.POSTGRES_URL_NON_POOLING) {
    console.log('🔧 Using POSTGRES_URL_NON_POOLING for database connection');
    return {
      connectionString: process.env.POSTGRES_URL_NON_POOLING,
      ssl: process.env.NODE_ENV === 'production'
    };
  }

  // Individual environment variables (also set by Vercel)
  if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DATABASE) {
    console.log('🔧 Using individual PostgreSQL environment variables');
    return {
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT || 5432,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      ssl: process.env.NODE_ENV === 'production'
    };
  }

  // Fallback for local development
  console.log('⚠️ No database environment variables found, using localhost fallback');
  return {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
    database: 'linkedinpost'
  };
};

const pool = new Pool(getDatabaseConfig());

async function migrateStatusConstraint() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting status constraint migration...');
    
    // First, check if the constraint exists
    console.log('🔍 Checking existing constraint...');
    const constraintQuery = `
      SELECT constraint_name, check_clause 
      FROM information_schema.check_constraints 
      WHERE constraint_name = 'user_subscriptions_status_check'
    `;
    const constraintResult = await client.query(constraintQuery);
    
    if (constraintResult.rows.length > 0) {
      console.log('📋 Current constraint:', constraintResult.rows[0]);
      
      // Drop the existing constraint
      console.log('🗑️ Dropping existing constraint...');
      await client.query(`
        ALTER TABLE user_subscriptions 
        DROP CONSTRAINT user_subscriptions_status_check
      `);
      console.log('✅ Existing constraint dropped');
    } else {
      console.log('ℹ️ No existing constraint found');
    }
    
    // Add the new constraint with all required statuses
    console.log('➕ Adding new constraint...');
    await client.query(`
      ALTER TABLE user_subscriptions 
      ADD CONSTRAINT user_subscriptions_status_check 
      CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid', 'incomplete'))
    `);
    console.log('✅ New constraint added with incomplete status');
    
    // Verify the new constraint
    const newConstraintResult = await client.query(constraintQuery);
    if (newConstraintResult.rows.length > 0) {
      console.log('✅ New constraint verified:', newConstraintResult.rows[0]);
    }
    
    console.log('🎉 Status constraint migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
migrateStatusConstraint()
  .then(() => {
    console.log('✅ Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }); 