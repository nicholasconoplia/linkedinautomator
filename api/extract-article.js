import { extract } from '@extractus/article-extractor';
import axios from 'axios';

export default async function handler(req, res) {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  try {
    console.log(`🌐 Extracting article content from: ${url}`);
    
    // First, try to resolve Google News redirects
    let finalUrl = url;
    
    if (url.includes('news.google.com')) {
      console.log(`🔗 Detected Google News URL, attempting to resolve...`);
      
      try {
        // Try to follow redirects to get the actual article URL
        const response = await axios.get(url, {
          maxRedirects: 5,
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        finalUrl = response.request.res.responseUrl || response.config.url || url;
        console.log(`✅ Resolved to: ${finalUrl}`);
        
        // If still a Google URL after redirects, try base64 decoding
        if (finalUrl.includes('google.com') && url.includes('CBM')) {
          console.log(`🧩 Attempting base64 decode...`);
          try {
            const match = url.match(/CBM[a-zA-Z0-9+/=]+/);
            if (match) {
              const base64Part = match[0].substring(3); // Remove 'CBM' prefix
              const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
              
              // Look for URLs in the decoded content
              const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
              if (urlMatch) {
                finalUrl = urlMatch[0];
                console.log(`🎯 Decoded URL: ${finalUrl}`);
              }
            }
          } catch (decodeError) {
            console.log(`⚠️ Base64 decode failed: ${decodeError.message}`);
          }
        }
        
      } catch (redirectError) {
        console.log(`⚠️ Redirect resolution failed: ${redirectError.message}, using original URL`);
      }
    }

    // Extract article content using @extractus/article-extractor
    console.log(`📄 Extracting content from final URL: ${finalUrl}`);
    
    const articleData = await extract(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!articleData || !articleData.content) {
      console.log(`⚠️ No content extracted from ${finalUrl}`);
      return res.status(400).json({ 
        error: 'Could not extract article content',
        url: finalUrl
      });
    }

    // Clean and validate content
    const cleanContent = articleData.content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    if (cleanContent.length < 100) {
      console.log(`⚠️ Content too short: ${cleanContent.length} characters`);
      return res.status(400).json({ 
        error: 'Article content too short',
        contentLength: cleanContent.length,
        url: finalUrl
      });
    }

    console.log(`✅ Successfully extracted ${cleanContent.length} characters from ${articleData.title || 'article'}`);
    
    return res.status(200).json({
      success: true,
      title: articleData.title || '',
      author: articleData.author || '',
      description: articleData.description || '',
      content: cleanContent.substring(0, 8000), // Limit for performance
      contentLength: cleanContent.length,
      publishedTime: articleData.published || '',
      url: finalUrl,
      originalUrl: url
    });

  } catch (error) {
    console.error(`❌ Failed to extract article from ${url}:`, error.message);
    
    // Try a fallback extraction method for stubborn URLs
    if (url.includes('google.com')) {
      console.log(`🔄 Trying fallback method for Google News URL...`);
      
      try {
        // Try to fetch the page directly and parse with basic HTML extraction
        const response = await axios.get(url, {
          timeout: 8000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        // Look for redirects in HTML content
        const html = response.data;
        const urlMatch = html.match(/url=([^"&]+)/i) || html.match(/href="([^"]+)"/i);
        
        if (urlMatch && urlMatch[1] && !urlMatch[1].includes('google.com')) {
          const fallbackUrl = decodeURIComponent(urlMatch[1]);
          console.log(`🎯 Found fallback URL: ${fallbackUrl}`);
          
          const fallbackData = await extract(fallbackUrl);
          if (fallbackData && fallbackData.content && fallbackData.content.length > 100) {
            return res.status(200).json({
              success: true,
              title: fallbackData.title || '',
              content: fallbackData.content.substring(0, 8000),
              contentLength: fallbackData.content.length,
              url: fallbackUrl,
              originalUrl: url,
              extractionMethod: 'fallback'
            });
          }
        }
      } catch (fallbackError) {
        console.log(`⚠️ Fallback method also failed: ${fallbackError.message}`);
      }
    }
    
    return res.status(500).json({ 
      error: 'Failed to extract article content',
      details: error.message,
      url: url
    });
  }
} 