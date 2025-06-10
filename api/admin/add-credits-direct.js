const { pool } = require('../../database');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin authentication
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== 'add-credits-direct-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { userId = 1, credits = 30 } = req.body;
    
    const client = await pool.connect();
    try {
      // Simply add credits to user account without usage tracking
      const result = await client.query(`
        UPDATE users 
        SET credits = credits + $1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $2 
        RETURNING credits
      `, [credits, userId]);
      
      const newBalance = result.rows[0]?.credits || 0;
      
      console.log(`✅ Added ${credits} credits to user ${userId}. New balance: ${newBalance}`);
      
      return res.json({
        success: true,
        message: `Added ${credits} credits to user ${userId}`,
        newBalance,
        creditsAdded: credits
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error adding credits:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
} 