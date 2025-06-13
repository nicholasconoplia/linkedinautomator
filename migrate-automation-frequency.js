const { Pool } = require('pg');
require('dotenv').config();

// Database configuration
const getDatabaseConfig = () => {
  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    };
  }
  
  return {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost', 
    database: process.env.DB_NAME || 'linkedin_automation',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
  };
};

const pool = new Pool(getDatabaseConfig());

async function migrateAutomationFrequency() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting automation frequency migration...');
    
    // Drop the existing constraint
    await client.query(`
      ALTER TABLE automation_settings 
      DROP CONSTRAINT IF EXISTS automation_settings_frequency_check
    `);
    
    console.log('✅ Dropped old frequency constraint');
    
    // Add the new constraint with additional frequency options
    await client.query(`
      ALTER TABLE automation_settings 
      ADD CONSTRAINT automation_settings_frequency_check 
      CHECK (frequency IN ('multiple_daily', 'twice_daily', 'daily', 'weekly', 'biweekly'))
    `);
    
    console.log('✅ Added new frequency constraint with multiple daily options');
    
    // Update any existing automation settings that might have invalid values
    const updateResult = await client.query(`
      UPDATE automation_settings 
      SET frequency = 'weekly' 
      WHERE frequency NOT IN ('multiple_daily', 'twice_daily', 'daily', 'weekly', 'biweekly')
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} automation settings with invalid frequency values`);
    
    // Show current frequency distribution
    const frequencyStats = await client.query(`
      SELECT frequency, COUNT(*) as count 
      FROM automation_settings 
      GROUP BY frequency 
      ORDER BY count DESC
    `);
    
    console.log('📊 Current frequency distribution:');
    frequencyStats.rows.forEach(row => {
      console.log(`   ${row.frequency}: ${row.count} users`);
    });
    
    console.log('🎉 Automation frequency migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the migration
if (require.main === module) {
  migrateAutomationFrequency()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateAutomationFrequency }; 