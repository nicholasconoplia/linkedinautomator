const { CreditDB } = require('../../database');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user from session - they must be authenticated
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { credits, description } = req.body;
  
  if (!credits || credits <= 0) {
    return res.status(400).json({ error: 'Valid credit amount is required' });
  }

  // For security, limit manual additions to reasonable amounts
  if (credits > 500) {
    return res.status(400).json({ error: 'Credit amount too large' });
  }

  try {
    const newBalance = await CreditDB.addCredits(
      user.id, 
      credits, 
      description || 'Manual credit addition'
    );
    
    return res.status(200).json({
      success: true,
      message: `Added ${credits} credits to your account`,
      creditsAdded: credits,
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