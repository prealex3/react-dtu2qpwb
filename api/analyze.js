// Vercel Edge Function — /api/analyze.js
// P5: Claude API integration — generates Alpha Score + investment brief per signal

export const config = {
    runtime: 'edge',
  };
  
  export default async function handler(req) {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }
  
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }
  
    const { name, company, indication, substance, status, tier, source } = body;
  
    if (!name) {
      return new Response(JSON.stringify({ error: 'Missing signal name' }), { status: 400 });
    }
  
    const prompt = `You are a biotech/pharma equity research analyst at a hedge fund. Analyze this regulatory signal and provide a concise, actionable investment brief.
  
  SIGNAL DATA:
  Drug name: ${name}
  Company: ${company || "Unknown"}
  Indication: ${indication || "Not specified"}
  Substance/Modality: ${substance || "Not specified"}
  Regulatory status: ${status || "Not specified"}
  Tier classification: ${tier?.label || "Unknown"} (${tier?.reason || ""})
  Source: ${source || "Unknown"}
  
  TASK: Using your existing knowledge (do not claim to search the web), provide:
  1. ALPHA SCORE: a number 1-10 reflecting investment attractiveness (10 = highest conviction), based on: market size for the indication, competitive landscape, modality differentiation, and regulatory milestone significance.
  2. ONE-LINE THESIS: a single sentence capturing why this matters for investors.
  3. KEY RISK: the single biggest risk to this thesis (competitive, clinical, regulatory, or financial).
  4. TICKER NOTE: if you recognize the company's stock ticker, mention it; otherwise say "Private or ticker unknown."
  
  Respond in EXACTLY this format, no preamble, no markdown headers:
  ALPHA_SCORE: [number]/10
  THESIS: [one sentence]
  RISK: [one sentence]
  TICKER: [ticker or note]
  
  Keep the entire response under 100 words total. Be direct and analytical, not promotional. If you are not confident about specifics (e.g., unfamiliar small-cap), say so honestly rather than fabricating details.`;
  
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
  
      if (!response.ok) {
        const errText = await response.text();
        return new Response(JSON.stringify({ error: `Claude API error: ${response.status}`, detail: errText.slice(0,200) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
  
      const data = await response.json();
      const text = (data.content || [])
        .map(block => block.type === 'text' ? block.text : '')
        .join('\n')
        .trim();
  
      return new Response(JSON.stringify({ brief: text }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, s-maxage=86400',
        },
      });
  
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }