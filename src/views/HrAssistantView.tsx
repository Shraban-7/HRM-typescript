'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AlertCircle,
  Archive,
  BookmarkPlus,
  Calculator,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  FileText,
  LogOut,
  MessageSquarePlus,
  MessageSquareText,
  Scale,
  Send,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  appendFirestoreChatMessage,
  archiveFirestoreChatSession,
  createFirestoreChatSession,
  createFirestoreHrNote,
  deleteFirestoreChatSession,
  deleteFirestoreHrNote,
  ensureFirestoreUserProfile,
  resolveFirestoreHrNote,
  signInWithGoogleFirebase,
  signOutFirebase,
  subscribeChatMessages,
  subscribeChatSessions,
  subscribeFirebaseAuth,
  subscribeHrNotes,
  type AllowedGeminiModel,
  type HrAssistantPersona,
  type HrNoteCategory,
  type StoredChatMessage,
  type StoredChatSession,
  type StoredHrNote,
} from '../lib/firebase';
import type { AuthUser, Branch } from '../types/hrm';
import { PageHeader, SegmentedTabs, StatusText } from '../components/ui/Primitives';

interface HrAssistantViewProps {
  user: AuthUser;
  branches: Branch[];
  selectedBranchId: number | null;
  onToast: (message: string) => void;
}

interface PersonaOption {
  id: HrAssistantPersona;
  label: string;
  shortLabel: string;
  subtitle: string;
  model: AllowedGeminiModel;
  modelDisplay: string;
  icon: React.ComponentType<{ className?: string }>;
  starters: string[];
}

const PERSONA_OPTIONS: PersonaOption[] = [
  {
    id: 'hr_advisor',
    label: 'HR Operations & Policy Advisor',
    shortLabel: 'HR Advisor',
    subtitle: 'Policies, leave compliance, onboarding & multi-branch operations',
    model: 'gemini-4-hydrogen',
    modelDisplay: 'Gemini 4 Hydrogen',
    icon: Scale,
    starters: [
      'Draft a hybrid attendance policy covering Austin HQ, New York, London, and Singapore branches.',
      'Outline a 30-60-90 day onboarding checklist for a Senior Engineering Manager.',
      'What steps should a manager follow before initiating an involuntary offboarding?',
    ],
  },
  {
    id: 'payroll_specialist',
    label: 'Payroll & Statutory Tax Specialist',
    shortLabel: 'Payroll & Tax',
    subtitle: 'Progressive brackets, FICA caps, proration & variance analysis',
    model: 'gemini-4-hydrogen',
    modelDisplay: 'Gemini 4 Hydrogen',
    icon: Calculator,
    starters: [
      'Explain how mid-month hire proration and unpaid leave deductions affect gross pay.',
      'Compare FICA Social Security wage cap impact for a $145,000 vs $198,000 annual salary.',
      'What payroll variance checks should we run before finalizing a monthly pay run?',
    ],
  },
  {
    id: 'quick_assistant',
    label: 'Quick HR Drafter',
    shortLabel: 'Quick Drafter',
    subtitle: 'Rapid employee memos, scorecards & policy summaries',
    model: 'gemini-3.1-flash-lite',
    modelDisplay: 'Gemini 3.1 Flash Lite',
    icon: Zap,
    starters: [
      'Write a crisp 120-word reminder to submit November timecards and expenses by Friday.',
      'Create a 5-question structured behavioral interview scorecard for a Product Designer.',
      'Summarize Q4 performance review deadlines and calibration steps for branch managers.',
    ],
  },
];

interface LocalSession {
  id: string;
  title: string;
  persona: HrAssistantPersona;
  model: AllowedGeminiModel;
  status: 'active' | 'archived';
  messages: Array<{
    id: string;
    sender: 'user' | 'assistant';
    content: string;
    model: string;
    createdAtMs: number;
  }>;
  updatedAtMs: number;
}

interface LocalNote {
  id: string;
  title: string;
  category: HrNoteCategory;
  body: string;
  status: 'open' | 'resolved';
  updatedAtMs: number;
}

function makeTitleFromPrompt(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 52) return singleLine;
  return `${singleLine.slice(0, 49)}...`;
}

export function HrAssistantView({
  user,
  branches,
  selectedBranchId,
  onToast,
}: HrAssistantViewProps) {
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'notes'>('chats');
  const [persona, setPersona] = useState<HrAssistantPersona>('hr_advisor');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Firebase Auth & Firestore Cloud Sync state
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudSessions, setCloudSessions] = useState<StoredChatSession[]>([]);
  const [cloudMessages, setCloudMessages] = useState<StoredChatMessage[]>([]);
  const [cloudNotes, setCloudNotes] = useState<StoredHrNote[]>([]);
  const [activeCloudSessionId, setActiveCloudSessionId] = useState<string | null>(null);

  // In-session fallback state when user hasn't connected Google Cloud Sync yet
  const [localSessions, setLocalSessions] = useState<LocalSession[]>([]);
  const [activeLocalSessionId, setActiveLocalSessionId] = useState<string | null>(null);
  const [localNotes, setLocalNotes] = useState<LocalNote[]>([]);

  // Quick HR Note form state
  const [noteTitle, setNoteTitle] = useState('');
  const [noteCategory, setNoteCategory] = useState<HrNoteCategory>('Policy');
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const activePersonaConfig = useMemo(
    () => PERSONA_OPTIONS.find((p) => p.id === persona) ?? PERSONA_OPTIONS[0],
    [persona]
  );

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId) ?? null,
    [branches, selectedBranchId]
  );

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsub = subscribeFirebaseAuth((nextUser) => {
      setFbUser(nextUser);
      if (nextUser) {
        void ensureFirestoreUserProfile(nextUser).catch(() => {
          // Handled inside firebase.ts
        });
      } else {
        setCloudSessions([]);
        setCloudMessages([]);
        setCloudNotes([]);
        setActiveCloudSessionId(null);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to Firestore chat sessions & HR notes when Google user is authenticated
  useEffect(() => {
    if (!fbUser) return;
    const unsubSessions = subscribeChatSessions(
      fbUser.uid,
      (sessions) => {
        setCloudSessions(sessions);
        setActiveCloudSessionId((prev) => {
          if (prev && sessions.some((s) => s.id === prev)) return prev;
          return sessions[0]?.id ?? null;
        });
      },
      () => {
        onToast('Unable to sync cloud conversations. Check account permissions.');
      }
    );

    const unsubNotes = subscribeHrNotes(
      fbUser.uid,
      (notes) => setCloudNotes(notes),
      () => {
        onToast('Unable to sync HR notes.');
      }
    );

    return () => {
      unsubSessions();
      unsubNotes();
    };
  }, [fbUser, onToast]);

  // Subscribe to messages for the active Firestore chat session
  useEffect(() => {
    if (!fbUser || !activeCloudSessionId) {
      setCloudMessages([]);
      return;
    }
    const unsub = subscribeChatMessages(
      fbUser.uid,
      activeCloudSessionId,
      (msgs) => setCloudMessages(msgs),
      () => {
        onToast('Unable to load conversation messages.');
      }
    );
    return () => unsub();
  }, [fbUser, activeCloudSessionId, onToast]);

  const activeSession = useMemo(() => {
    if (fbUser) {
      return cloudSessions.find((s) => s.id === activeCloudSessionId) ?? null;
    }
    return localSessions.find((s) => s.id === activeLocalSessionId) ?? null;
  }, [fbUser, cloudSessions, activeCloudSessionId, localSessions, activeLocalSessionId]);

  const activeMessages = useMemo(() => {
    if (fbUser) {
      return cloudMessages;
    }
    const current = localSessions.find((s) => s.id === activeLocalSessionId);
    return current ? current.messages : [];
  }, [fbUser, cloudMessages, localSessions, activeLocalSessionId]);

  const isArchivedSession = activeSession?.status === 'archived';

  // Auto-scroll to latest message
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeMessages.length, sending]);

  async function handleGoogleSignIn() {
    setAuthBusy(true);
    try {
      const signedIn = await signInWithGoogleFirebase();
      onToast(`Cloud sync connected as ${signedIn.email ?? signedIn.displayName ?? 'Google account'}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in was cancelled.';
      onToast(message.includes('popup-closed') ? 'Google sign-in popup was closed.' : message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignOut() {
    setAuthBusy(true);
    try {
      await signOutFirebase();
      onToast('Disconnected Google cloud sync.');
    } catch {
      onToast('Unable to disconnect Google account.');
    } finally {
      setAuthBusy(false);
    }
  }

  function handleStartNewChat() {
    setChatError(null);
    if (fbUser) {
      setActiveCloudSessionId(null);
      setCloudMessages([]);
    } else {
      setActiveLocalSessionId(null);
    }
  }

  async function handleSendMessage(overrideText?: string) {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || sending || isArchivedSession) return;

    setChatError(null);
    setSending(true);
    if (!overrideText) setInput('');

    const workspaceContext = [
      `Signed-in user: ${user.fullName} (${user.roles.join(', ')})`,
      activeBranch
        ? `Selected branch filter: ${activeBranch.name} (${activeBranch.code}, ${activeBranch.city}, ${activeBranch.country})`
        : `Branch scope: All ${branches.length} branches (${branches.map((b) => b.name).join(', ')})`,
    ].join('\n');

    const priorTurns = activeMessages.slice(-20).map((m) => ({
      sender: m.sender,
      content: m.content,
    }));

    let cloudSessionId = activeCloudSessionId;
    let localSessionId = activeLocalSessionId;
    const baseCount = activeMessages.length;

    try {
      if (fbUser) {
        if (!cloudSessionId) {
          cloudSessionId = await createFirestoreChatSession(fbUser.uid, {
            title: makeTitleFromPrompt(trimmed),
            persona,
            model: activePersonaConfig.model,
          });
          setActiveCloudSessionId(cloudSessionId);
        }

        await appendFirestoreChatMessage(fbUser.uid, cloudSessionId, {
          sender: 'user',
          content: trimmed,
          model: activePersonaConfig.model,
          nextMessageCount: baseCount + 1,
          updatedTitle: baseCount === 0 ? makeTitleFromPrompt(trimmed) : undefined,
          persona,
        });
      } else {
        const userMsgId = `local_u_${Date.now()}`;
        if (!localSessionId) {
          localSessionId = `local_sess_${Date.now()}`;
          const created: LocalSession = {
            id: localSessionId,
            title: makeTitleFromPrompt(trimmed),
            persona,
            model: activePersonaConfig.model,
            status: 'active',
            updatedAtMs: Date.now(),
            messages: [
              {
                id: userMsgId,
                sender: 'user',
                content: trimmed,
                model: activePersonaConfig.model,
                createdAtMs: Date.now(),
              },
            ],
          };
          setLocalSessions((prev) => [created, ...prev]);
          setActiveLocalSessionId(localSessionId);
        } else {
          setLocalSessions((prev) =>
            prev.map((s) =>
              s.id === localSessionId
                ? {
                    ...s,
                    persona,
                    model: activePersonaConfig.model,
                    updatedAtMs: Date.now(),
                    messages: [
                      ...s.messages,
                      {
                        id: userMsgId,
                        sender: 'user',
                        content: trimmed,
                        model: activePersonaConfig.model,
                        createdAtMs: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona,
          messages: [...priorTurns, { sender: 'user', content: trimmed }],
          workspaceContext,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        reply?: string;
        model?: AllowedGeminiModel;
        error?: string;
      };

      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || `Assistant request failed (${response.status}).`);
      }

      const replyModel: AllowedGeminiModel = payload.model ?? activePersonaConfig.model;

      if (fbUser && cloudSessionId) {
        await appendFirestoreChatMessage(fbUser.uid, cloudSessionId, {
          sender: 'assistant',
          content: payload.reply,
          model: replyModel,
          nextMessageCount: baseCount + 2,
          persona,
        });
      } else if (localSessionId) {
        const assistantMsgId = `local_a_${Date.now()}`;
        setLocalSessions((prev) =>
          prev.map((s) =>
            s.id === localSessionId
              ? {
                  ...s,
                  updatedAtMs: Date.now(),
                  messages: [
                    ...s.messages,
                    {
                      id: assistantMsgId,
                      sender: 'assistant',
                      content: payload.reply!,
                      model: replyModel,
                      createdAtMs: Date.now(),
                    },
                  ],
                }
              : s
          )
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send message.';
      setChatError(message);
    } finally {
      setSending(false);
    }
  }

  async function handlePinAssistantReply(content: string) {
    const derivedTitle = makeTitleFromPrompt(content.replace(/[#*_`>-]/g, ' ').trim());
    const category: HrNoteCategory =
      persona === 'payroll_specialist' ? 'Payroll' : persona === 'hr_advisor' ? 'Policy' : 'General';

    if (fbUser) {
      try {
        await createFirestoreHrNote(fbUser.uid, {
          title: derivedTitle,
          category,
          body: content,
        });
        setSidebarTab('notes');
        onToast('Pinned response to your cloud-synced HR Notes.');
      } catch {
        onToast('Unable to save HR note.');
      }
    } else {
      const note: LocalNote = {
        id: `local_note_${Date.now()}`,
        title: derivedTitle,
        category,
        body: content,
        status: 'open',
        updatedAtMs: Date.now(),
      };
      setLocalNotes((prev) => [note, ...prev]);
      setSidebarTab('notes');
      onToast('Pinned response to HR Notes for this session.');
    }
  }

  async function handleCreateManualNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim() || !noteBody.trim() || savingNote) return;

    setSavingNote(true);
    try {
      if (fbUser) {
        await createFirestoreHrNote(fbUser.uid, {
          title: noteTitle.trim(),
          category: noteCategory,
          body: noteBody.trim(),
        });
        onToast('Saved HR note to cloud storage.');
      } else {
        setLocalNotes((prev) => [
          {
            id: `local_note_${Date.now()}`,
            title: noteTitle.trim(),
            category: noteCategory,
            body: noteBody.trim(),
            status: 'open',
            updatedAtMs: Date.now(),
          },
          ...prev,
        ]);
        onToast('Saved HR note for this session.');
      }
      setNoteTitle('');
      setNoteBody('');
    } catch {
      onToast('Unable to save HR note.');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleResolveNote(noteId: string) {
    if (fbUser) {
      try {
        await resolveFirestoreHrNote(fbUser.uid, noteId);
        onToast('Marked HR note as resolved.');
      } catch {
        onToast('Unable to update note.');
      }
    } else {
      setLocalNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, status: 'resolved', updatedAtMs: Date.now() } : n))
      );
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (fbUser) {
      try {
        await deleteFirestoreHrNote(fbUser.uid, noteId);
        onToast('Deleted HR note.');
      } catch {
        onToast('Unable to delete note.');
      }
    } else {
      setLocalNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
  }

  async function handleArchiveSession(sessionId: string) {
    if (fbUser) {
      try {
        await archiveFirestoreChatSession(fbUser.uid, sessionId);
        onToast('Conversation archived.');
      } catch {
        onToast('Unable to archive conversation.');
      }
    } else {
      setLocalSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'archived' } : s))
      );
    }
  }

  async function handleDeleteSession(sessionId: string) {
    if (fbUser) {
      try {
        await deleteFirestoreChatSession(fbUser.uid, sessionId);
        if (activeCloudSessionId === sessionId) {
          setActiveCloudSessionId(null);
        }
        onToast('Conversation removed.');
      } catch {
        onToast('Unable to delete conversation.');
      }
    } else {
      setLocalSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeLocalSessionId === sessionId) {
        setActiveLocalSessionId(null);
      }
    }
  }

  async function handleCopy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1600);
    } catch {
      onToast('Copy unavailable in this browser context.');
    }
  }

  const displayedSessions = fbUser
    ? cloudSessions.map((s) => ({
        id: s.id,
        title: s.title,
        persona: s.persona,
        status: s.status,
        messageCount: s.messageCount,
      }))
    : localSessions.map((s) => ({
        id: s.id,
        title: s.title,
        persona: s.persona,
        status: s.status,
        messageCount: s.messages.length,
      }));

  const displayedNotes = fbUser ? cloudNotes : localNotes;
  const activeSessionId = fbUser ? activeCloudSessionId : activeLocalSessionId;

  return (
    <div className="space-y-5">
      <PageHeader
        title="HR Assistant"
        description="Multi-turn HR policy, payroll tax, and compliance advisor powered by Gemini with optional Google Cloud Sync."
        action={
          <button
            type="button"
            onClick={handleStartNewChat}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>New Conversation</span>
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Panel: Cloud Sync + History / HR Notes */}
        <div className="lg:col-span-4 space-y-4">
          {/* Google Cloud Sync Card */}
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                  <Cloud className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Cloud Conversation Sync</span>
                </div>
                {fbUser ? (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                    Synced as {fbUser.email || fbUser.displayName}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    Sign in with Google to persist chat history and pinned HR notes across sessions.
                  </p>
                )}
              </div>
              {fbUser ? (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignOut}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignIn}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <span>{authBusy ? 'Connecting...' : 'Sign in with Google'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Conversations / HR Notes Panel */}
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2">
              <SegmentedTabs
                tabs={[
                  { id: 'chats', label: 'Conversations', count: displayedSessions.length },
                  { id: 'notes', label: 'HR Notes', count: displayedNotes.length },
                ]}
                active={sidebarTab}
                onChange={setSidebarTab}
              />
            </div>

            {sidebarTab === 'chats' ? (
              <div className="max-h-[460px] overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800">
                {displayedSessions.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <MessageSquareText className="w-5 h-5 text-neutral-400 mx-auto" />
                    <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      No conversations yet
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      Pick a starter prompt or ask an HR question to begin a multi-turn thread.
                    </p>
                  </div>
                ) : (
                  displayedSessions.map((session) => {
                    const isSelected = session.id === activeSessionId;
                    const pMeta =
                      PERSONA_OPTIONS.find((p) => p.id === session.persona) ?? PERSONA_OPTIONS[0];
                    return (
                      <div
                        key={session.id}
                        className={`px-3.5 py-3 flex items-start justify-between gap-2 transition-colors ${
                          isSelected
                            ? 'bg-blue-50/60 dark:bg-blue-950/25'
                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setChatError(null);
                            setPersona(session.persona);
                            if (fbUser) {
                              setActiveCloudSessionId(session.id);
                            } else {
                              setActiveLocalSessionId(session.id);
                            }
                          }}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                            {session.title}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                            <span>{pMeta.shortLabel}</span>
                            <span>·</span>
                            <span className="font-mono tabular-nums">{session.messageCount} turns</span>
                            {session.status === 'archived' && (
                              <>
                                <span>·</span>
                                <span className="text-amber-700 dark:text-amber-400">Archived</span>
                              </>
                            )}
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {session.status === 'active' && (
                            <button
                              type="button"
                              title="Archive conversation"
                              aria-label="Archive conversation"
                              onClick={() => handleArchiveSession(session.id)}
                              className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Delete conversation"
                            aria-label="Delete conversation"
                            onClick={() => handleDeleteSession(session.id)}
                            className="p-1 rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="p-3.5 space-y-3.5">
                <form onSubmit={handleCreateManualNote} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={noteTitle}
                      onChange={(e) => setNoteTitle(e.target.value)}
                      placeholder="Note title..."
                      maxLength={160}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                    <select
                      aria-label="HR Note category"
                      value={noteCategory}
                      onChange={(e) => setNoteCategory(e.target.value as HrNoteCategory)}
                      className="px-2 py-1.5 text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-800 dark:text-neutral-200"
                    >
                      <option value="Policy">Policy</option>
                      <option value="Payroll">Payroll</option>
                      <option value="Compliance">Compliance</option>
                      <option value="General">General</option>
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Capture a compliance action item or payroll follow-up..."
                    maxLength={4000}
                    className="w-full px-2.5 py-1.5 text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
                  />
                  <button
                    type="submit"
                    disabled={savingNote || !noteTitle.trim() || !noteBody.trim()}
                    className="w-full py-1.5 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-medium disabled:opacity-45 cursor-pointer"
                  >
                    {savingNote ? 'Saving...' : 'Save HR Note'}
                  </button>
                </form>

                <div className="max-h-[300px] overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800 border-t border-neutral-200 dark:border-neutral-800 pt-2">
                  {displayedNotes.length === 0 ? (
                    <div className="py-6 text-center">
                      <FileText className="w-5 h-5 text-neutral-400 mx-auto" />
                      <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                        Pin any assistant reply or add a follow-up note above.
                      </p>
                    </div>
                  ) : (
                    displayedNotes.map((note) => (
                      <div key={note.id} className="py-2.5 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                              {note.title}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                              <span>{note.category}</span>
                              <span>·</span>
                              <StatusText status={note.status} />
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {note.status === 'open' && (
                              <button
                                type="button"
                                title="Mark resolved"
                                aria-label="Mark note resolved"
                                onClick={() => handleResolveNote(note.id)}
                                className="p-1 rounded text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Delete note"
                              aria-label="Delete note"
                              onClick={() => handleDeleteNote(note.id)}
                              className="p-1 rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-neutral-600 dark:text-neutral-400 line-clamp-3 whitespace-pre-wrap">
                          {note.body}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Active Multi-Turn Gemini Chat */}
        <div className="lg:col-span-8 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg flex flex-col overflow-hidden">
          {/* Role Persona Switcher Header */}
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/50 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                  {activePersonaConfig.label}
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {activePersonaConfig.subtitle} · {activePersonaConfig.modelDisplay}
                </div>
              </div>
              {activeBranch && (
                <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  Branch Context: {activeBranch.name}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PERSONA_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = option.id === persona;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPersona(option.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white dark:bg-neutral-800 border-blue-500/60 text-blue-700 dark:text-blue-300 shadow-2xs'
                        : 'bg-transparent border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-white dark:hover:bg-neutral-800/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{option.shortLabel}</div>
                      <div className="text-[10px] opacity-75 truncate">{option.modelDisplay}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Message Thread */}
          <div
            role="log"
            aria-live="polite"
            aria-label="HR Assistant conversation thread"
            className="h-[440px] sm:h-[500px] overflow-y-auto px-5 py-5 space-y-4"
          >
            {activeMessages.length === 0 ? (
              <div className="h-full flex flex-col justify-center max-w-xl mx-auto py-4">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Ask Nexus HR Assistant
                </h2>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  Conversation history is preserved across follow-up turns so you can refine policies,
                  audit payroll formulas, or draft branch announcements step by step.
                </p>

                <div className="mt-5 space-y-2">
                  <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                    Suggested prompts for {activePersonaConfig.shortLabel}
                  </div>
                  {activePersonaConfig.starters.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={sending}
                      onClick={() => handleSendMessage(prompt)}
                      className="w-full text-left px-3.5 py-2.5 rounded-md border border-neutral-200 dark:border-neutral-800 hover:border-blue-400 dark:hover:border-blue-500/60 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 text-xs text-neutral-700 dark:text-neutral-300 transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {activeMessages.map((msg) => {
                  const isUser = msg.sender === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[88%] sm:max-w-[80%] rounded-lg px-4 py-3 ${
                          isUser
                            ? 'bg-blue-600 text-white'
                            : 'bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 mb-1">
                          <span
                            className={`text-[11px] font-medium ${
                              isUser ? 'text-blue-100' : 'text-neutral-500 dark:text-neutral-400'
                            }`}
                          >
                            {isUser ? user.fullName : activePersonaConfig.shortLabel}
                          </span>
                          {!isUser && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopy(msg.id, msg.content)}
                                title="Copy response"
                                aria-label="Copy response"
                                className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                              >
                                {copiedId === msg.id ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                              </button>
                              <span className="text-neutral-300 dark:text-neutral-700">·</span>
                              <button
                                type="button"
                                onClick={() => handlePinAssistantReply(msg.content)}
                                title="Pin to HR Notes"
                                aria-label="Pin response to HR Notes"
                                className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                              >
                                <BookmarkPlus className="w-3 h-3" />
                                <span>Pin Note</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {isUser ? (
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div className="text-sm leading-relaxed space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_code]:font-mono [&_code]:text-xs [&_code]:bg-neutral-200/70 [&_code]:dark:bg-neutral-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_th]:text-left [&_th]:border-b [&_th]:border-neutral-300 [&_th]:dark:border-neutral-700 [&_th]:py-1.5 [&_th]:pr-3 [&_td]:border-b [&_td]:border-neutral-200 [&_td]:dark:border-neutral-800 [&_td]:py-1.5 [&_td]:pr-3">
                            <Markdown>{msg.content}</Markdown>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-4 py-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 animate-pulse">
                        Drafting response with {activePersonaConfig.modelDisplay}...
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Inline Error Banner */}
          {chatError && (
            <div
              role="alert"
              className="mx-4 mb-2 px-3.5 py-2.5 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 flex items-start gap-2 text-xs text-red-700 dark:text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{chatError}</span>
            </div>
          )}

          {/* Multi-Line Composer */}
          <div className="p-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40">
            {isArchivedSession ? (
              <div className="flex items-center justify-between gap-3 py-1.5 px-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span>This conversation is archived and read-only.</span>
                <button
                  type="button"
                  onClick={handleStartNewChat}
                  className="text-blue-600 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                >
                  Start a new conversation
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSendMessage();
                }}
                className="flex items-end gap-2.5"
              >
                <label htmlFor="hr-assistant-input" className="sr-only">
                  Ask HR Assistant
                </label>
                <textarea
                  id="hr-assistant-input"
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  placeholder={`Ask ${activePersonaConfig.shortLabel} a question... (Enter to send, Shift+Enter for new line)`}
                  disabled={sending}
                  maxLength={8000}
                  className="flex-1 px-3 py-2 text-sm bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-medium transition-colors cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sending ? 'Sending...' : 'Send'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
