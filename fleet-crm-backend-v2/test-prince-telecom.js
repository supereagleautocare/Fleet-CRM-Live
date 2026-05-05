/**
 * Test script — can Claude find Prince Telecom in Charlotte NC?
 * Run: node test-prince-telecom.js
 * Requires ANTHROPIC_API_KEY in environment or hardcoded below.
 */

const Anthropic = require('@anthropic-ai/sdk');

const API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_KEY_HERE';

const client = new Anthropic({ apiKey: API_KEY });

const systemPrompt = `You are a fleet business discovery agent for an automotive repair shop in Charlotte, NC.
Your job is to find LOCAL businesses that operate fleets of vehicles and need regular vehicle maintenance.

You are searching for a specific company: Prince Telecom. This is a telecom subcontractor company
believed to have a significant operation in the Charlotte, NC area. They likely have 50-100+ vehicles
but may not have a strong consumer web presence since they are a B2B contractor.

Use every tactic available to find them:
- Search Google for "Prince Telecom Charlotte NC"
- Check FMCSA SAFER database for their DOT registration (site:safer.fmcsa.dot.gov)
- Search LinkedIn for Prince Telecom employees in Charlotte
- Search Indeed for job postings from Prince Telecom in Charlotte
- Try to find their website and look for a locations or service areas page
- Search for telecom subcontractors doing Google Fiber, AT&T, or Comcast work in Charlotte

Report everything you find: physical address, phone number, website, estimated fleet size,
what vehicles they likely operate, any contact names, and EXACTLY where you found each piece of info.`;

const userPrompt = `Find Prince Telecom's Charlotte NC operation.
Search multiple sources — Google, FMCSA, LinkedIn, Indeed, and their website.
Tell me exactly what you find and where you found it.`;

async function runTest() {
  console.log('Testing Claude web search with Haiku model...');
  console.log('Looking for: Prince Telecom in Charlotte NC\n');
  console.log('─'.repeat(60));

  const messages = [{ role: 'user', content: userPrompt }];
  let turnCount = 0;
  let fullOutput = '';

  try {
    while (turnCount < 6) {
      turnCount++;
      console.log(`\n[Turn ${turnCount}]`);

      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system:     systemPrompt,
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });

      console.log(`Stop reason: ${response.stop_reason}`);
      console.log(`Tokens: ${response.usage?.input_tokens} in / ${response.usage?.output_tokens} out`);

      if (response.stop_reason === 'end_turn') {
        for (const block of response.content) {
          if (block.type === 'text') {
            fullOutput += block.text;
            console.log('\n--- CLAUDE OUTPUT ---');
            console.log(block.text);
          }
        }
        break;
      }

      if (response.stop_reason === 'tool_use') {
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`Searching: "${block.input?.query || JSON.stringify(block.input)}"`);
          }
        }
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = response.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
        if (toolResults.length) {
          messages.push({ role: 'user', content: toolResults });
        } else {
          break;
        }
      } else {
        break;
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log('Test complete.');

  } catch (err) {
    console.error('\n--- ERROR ---');
    console.error('Status:', err.status);
    console.error('Message:', err.message);
    if (err.error) console.error('Detail:', JSON.stringify(err.error, null, 2));
  }
}

runTest();
