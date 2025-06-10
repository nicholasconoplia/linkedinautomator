const { CreditDB } = require('../../database');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin authentication
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== 'add-credits-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId, credits, description } = req.body;
  
  if (!userId || !credits) {
    return res.status(400).json({ error: 'userId and credits are required' });
  }

  try {
    const newBalance = await CreditDB.addCredits(
      userId, 
      credits, 
      description || 'Admin credit addition'
    );
    
    return res.status(200).json({
      success: true,
      message: `Added ${credits} credits to user ${userId}`,
      newBalance: newBalance
    });
    
  } catch (error) {
    console.error('Error adding credits:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
} 