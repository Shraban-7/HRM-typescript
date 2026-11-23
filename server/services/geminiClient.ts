import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';

export type HrAssistantPersona = 'hr_advisor' | 'payroll_specialist' | 'quick_assistant';
export type AllowedGeminiModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

export interface PersonaConfig {
  id: HrAssistantPersona;
  label: string;
  subtitle: string;
  model: AllowedGeminiModel;
  systemInstruction: string;
}

export const HR_ASSISTANT_PERSONAS: Record<HrAssistantPersona, PersonaConfig> = {
  hr_advisor: {
    id: 'hr_advisor',
    label: 'HR Operations & Policy Advisor',
    subtitle: 'Policies, leave compliance, onboarding & org guidance (Gemini 4 Hydrogen)',
    model: 'gemini-4-hydrogen',
    systemInstruction:
      'You are the Nexus HRM Operations & Policy Advisor for a multi-branch enterprise (Austin HQ, New York East, London EMEA, Singapore APAC). Give accurate, structured, practical HR guidance covering employee policies, leave calculations, onboarding/offboarding checklists, performance calibration, and workplace compliance. Keep answers concise, actionable, and formatted in clean Markdown with bullet points where helpful. Never invent employee salary figures or personal data not provided in the conversation.',
  },
  payroll_specialist: {
    id: 'payroll_specialist',
    label: 'Payroll & Statutory Tax Specialist',
    subtitle: 'Brackets, FICA caps, proration & variance audits (Gemini 4 Hydrogen)',
    model: 'gemini-4-hydrogen',
    systemInstruction:
      'You are the Nexus HRM Payroll & Statutory Tax Specialist. Explain progressive federal withholding brackets, branch state tax rates, FICA Social Security wage caps, Medicare/Additional Medicare, pre-tax 401(k) and Section 125 deductions, mid-month hire/exit proration, overtime multipliers, and payroll variance audits with mathematical precision. Format calculations clearly using Markdown tables or bullet lists, and remind users to confirm formal filings with certified payroll counsel when appropriate.',
  },
  quick_assistant: {
    id: 'quick_assistant',
    label: 'Quick HR Drafter (Fast)',
    subtitle: 'Rapid HR emails, job descriptions & checklists (Gemini 3.1 Flash Lite)',
    model: 'gemini-3.1-flash-lite',
    systemInstruction:
      'You are a fast, sharp HR communication assistant for Nexus HRM. Draft concise employee announcements, interview scorecards, policy summaries, and quick Q&A responses in under 200 words unless asked for more detail. Use crisp executive tone and clean Markdown.',
  },
};

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ChatTurnInput {
  sender: 'user' | 'assistant';
  content: string;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('timeout');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

export async function runHrChatTurn(params: {
  persona: HrAssistantPersona;
  history: ChatTurnInput[];
  latestMessage: string;
  workspaceContext?: string;
}): Promise<{ reply: string; model: AllowedGeminiModel }> {
  const ai = getGeminiClient();
  const cfg = HR_ASSISTANT_PERSONAS[params.persona];

  const systemInstruction = params.workspaceContext
    ? `${cfg.systemInstruction}\n\nActive workspace context:\n${params.workspaceContext}`
    : cfg.systemInstruction;

  const formattedHistory = params.history.map((turn) => ({
    role: turn.sender === 'user' ? 'user' : 'model',
    parts: [{ text: turn.content }],
  }));

  const chat = ai.chats.create({
    model: cfg.model,
    history: formattedHistory,
    config: {
      systemInstruction,
    },
  });

  const response: GenerateContentResponse = await withRetry(() =>
    chat.sendMessage({ message: params.latestMessage })
  );

  const replyText = (response.text ?? '').trim();
  if (!replyText) {
    throw new Error('The assistant returned an empty response. Please try rephrasing your question.');
  }

  return {
    reply: replyText,
    model: cfg.model,
  };
}
