import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  type HrAssistantPersona,
  runHrChatTurn,
} from '../../../../server/services/geminiClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const chatRequestSchema = z.object({
  persona: z.enum(['hr_advisor', 'payroll_specialist', 'quick_assistant']).default('hr_advisor'),
  messages: z
    .array(
      z.object({
        sender: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(8000),
      })
    )
    .min(1)
    .max(24),
  workspaceContext: z.string().max(1200).optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Provide a valid conversation history with at least one user message.' },
      { status: 400 }
    );
  }

  const { persona, messages, workspaceContext } = parsed.data;
  const latest = messages[messages.length - 1];
  if (latest.sender !== 'user') {
    return NextResponse.json({ error: 'The latest turn must be a user message.' }, { status: 400 });
  }

  const history = messages.slice(0, -1);

  try {
    const result = await runHrChatTurn({
      persona: persona as HrAssistantPersona,
      history,
      latestMessage: latest.content,
      workspaceContext,
    });

    return NextResponse.json({
      reply: result.reply,
      model: result.model,
      persona,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach Gemini right now.';
    console.error('[Nexus HRM Gemini Chat Error]', message);

    if (message.includes('GEMINI_API_KEY') || message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
      return NextResponse.json(
        {
          error:
            'Gemini API key is missing or invalid. Verify GEMINI_API_KEY in your environment settings (Settings > Secrets or Vercel Environment Variables).',
        },
        { status: 503 }
      );
    }

    if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
      return NextResponse.json(
        {
          error:
            'Gemini rate limit or quota was reached. Please wait a moment and try again, or verify your billing tier in Settings > Secrets.',
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: `Assistant request failed: ${message}` },
      { status: 500 }
    );
  }
}
