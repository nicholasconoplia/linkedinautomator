const { Pool } = require('pg');

async function migrateUsageTrackingConstraint() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Starting usage_tracking constraint migration...');
    
    // Drop the existing constraint
    console.log('📝 Dropping existing constraint...');
    await pool.query(`
      ALTER TABLE usage_tracking 
      DROP CONSTRAINT IF EXISTS usage_tracking_action_type_check;
    `);
    
    // Add the new constraint with manual_post_generation included
    console.log('📝 Adding updated constraint...');
    await pool.query(`
      ALTER TABLE usage_tracking 
      ADD CONSTRAINT usage_tracking_action_type_check 
      CHECK (action_type IN ('post_generation', 'post_publish', 'image_fetch', 'credit_added', 'credit_deducted', 'manual_post_generation'));
    `);
    
    console.log('✅ Usage tracking constraint migration completed successfully!');
    console.log('📊 New allowed action types: post_generation, post_publish, image_fetch, credit_added, credit_deducted, manual_post_generation');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateUsageTrackingConstraint()
    .then(() => {
      console.log('🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateUsageTrackingConstraint }; 